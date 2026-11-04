#!/usr/bin/env python3
"""Digest-pinned Family Hub deployment. Requires Docker Compose v2; optional gh for update."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

FILES = ('compose.yml', 'compose.vpn.yml', 'Caddyfile', 'images.yml', 'release.py')
VERSION = re.compile(r'familyhub-v\d+\.\d+\.\d+\Z')
# Optional push notifications (ntfy). Root-only file: NTFY_URL=https://ntfy.sh/<private topic>
# and, for a protected topic, NTFY_TOKEN=<access token>. See deploy/familyhub/admin/README.md.
NOTIFY_FILES = ('/etc/familyhub-notify.env', '/etc/familyhub-renewals.env')
REPEAT_FAILURE_AFTER = 24 * 3600


def read_notify_settings(files=NOTIFY_FILES):
    settings = {}
    for name in files:
        try:
            for line in Path(name).read_text().splitlines():
                key, sep, value = line.strip().partition('=')
                if sep and key in ('NTFY_URL', 'NTFY_TOKEN') and key not in settings:
                    settings[key] = value.strip().strip('"\'')
        except OSError:
            continue
    return settings if settings.get('NTFY_URL', '').startswith('https://') else {}


def notify(title, message, priority='default', tags='', settings=None):
    """Best effort: a notification never stops or fails a deployment."""
    settings = read_notify_settings() if settings is None else settings
    if not settings:
        return False
    headers = {'Title': title, 'Priority': priority, 'Tags': tags}
    if settings.get('NTFY_TOKEN'):
        headers['Authorization'] = 'Bearer ' + settings['NTFY_TOKEN']
    try:
        request = urllib.request.Request(settings['NTFY_URL'], data=message.encode(), headers=headers, method='POST')
        with urllib.request.urlopen(request, timeout=10):
            return True
    except Exception:
        return False


def version_key(version):
    return tuple(int(part) for part in version[len('familyhub-v'):].split('.'))


def newest_release(releases, blocked):
    eligible = [r['tagName'] for r in releases if not r['isDraft'] and not r['isPrerelease']
                and VERSION.fullmatch(r['tagName']) and r['tagName'] not in blocked]
    return max(eligible, key=version_key) if eligible else None


def validate_package(folder):
    folder = Path(folder)
    manifest = json.loads((folder / 'manifest.json').read_text())
    if manifest.get('schema') != 1 or not VERSION.fullmatch(manifest.get('version', '')):
        raise ValueError('Invalid release manifest/version')
    if manifest.get('rollbackSafe') is not True:
        raise ValueError('This release requires a manual database migration plan')
    for service in ('server', 'client'):
        image = manifest.get(service + 'Image', '')
        if not re.fullmatch(r'ghcr\.io/santoshgs/familyhub-' + service + r'@sha256:[a-f0-9]{64}', image):
            raise ValueError('Expected a Family Hub image pinned by digest')
    for name in FILES:
        file = folder / name
        if file.is_symlink() or not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != manifest.get('files', {}).get(name):
            raise ValueError('Release file integrity check failed: ' + name)
    return manifest


def unpack(archive, destination):
    # Only fixed, regular files; never extract paths, links, devices or executables.
    allowed = set(FILES) | {'manifest.json', 'release.py', 'env.example'}
    with tarfile.open(archive, 'r:gz') as source:
        seen = set()
        for entry in source:
            if entry.name not in allowed or not entry.isfile() or entry.size > 1024 * 1024 or entry.name in seen:
                raise ValueError('Unexpected entry in release archive')
            seen.add(entry.name)
            content = source.extractfile(entry)
            (Path(destination) / entry.name).write_bytes(content.read())
    return validate_package(destination)


class Deployment:
    def __init__(self, state, env_file):
        self.state = Path(state).resolve()
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.state, 0o700)
        self.env_file = Path(env_file).resolve()
        if not self.env_file.is_file():
            raise ValueError('Private deployment environment file is missing')
        if self.env_file.stat().st_mode & 0o077:
            raise ValueError('Private deployment environment must have owner-only permissions (chmod 600)')

    def compose(self, folder, *args, output=None):
        manifest = validate_package(folder)
        env = dict(os.environ, COMPOSE_PROFILES='', FAMILYHUB_SERVER_IMAGE=manifest['serverImage'], FAMILYHUB_CLIENT_IMAGE=manifest['clientImage'])
        command = ['docker', 'compose', '--project-name', 'familyhub', '--env-file', str(self.env_file),
                   '-f', str(Path(folder) / 'compose.yml'), '-f', str(Path(folder) / 'compose.vpn.yml'), '-f', str(Path(folder) / 'images.yml'), *args]
        result = subprocess.run(command, env=env, stdout=output or subprocess.DEVNULL, stderr=subprocess.PIPE)
        if result.returncode:
            # Raw compose errors may include environment values. Keep private diagnostics local.
            raise RuntimeError('Docker deployment command failed; inspect container health locally')

    def current(self):
        file = self.state / 'current.json'
        return json.loads(file.read_text()) if file.exists() else None

    def blocked(self):
        file = self.state / 'blocked.json'
        return json.loads(file.read_text()) if file.exists() else []

    def block(self, version):
        file = self.state / 'blocked.json'
        file.write_text(json.dumps(sorted(set(self.blocked() + [version]))))
        os.chmod(file, 0o600)

    def record(self, current, previous):
        temp = self.state / 'current.tmp'
        temp.write_text(json.dumps({'current': current, 'previous': previous}, indent=2))
        os.chmod(temp, 0o600)
        temp.replace(self.state / 'current.json')

    def folder(self, version):
        if not isinstance(version, str) or not VERSION.fullmatch(version):
            raise ValueError('Invalid release version')
        return self.state / 'releases' / version

    def promote(self, folder):
        self.compose(folder, 'up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180')

    def backup(self, folder):
        directory = Path(tempfile.mkdtemp(prefix='pre-update-', dir=self.state))
        os.chmod(directory, 0o700)
        # Dump a consistent snapshot before migrations; never expose a password on argv.
        with (directory / 'database.dump').open('wb') as output:
            os.chmod(directory / 'database.dump', 0o600)
            self.compose(folder, 'exec', '-T', 'postgres', 'pg_dump', '-U', 'familyhub', '-d', 'familyhub', '-Fc', output=output)
        with (directory / 'uploads.tar.gz').open('wb') as output:
            os.chmod(directory / 'uploads.tar.gz', 0o600)
            self.compose(folder, 'exec', '-T', 'server', 'tar', '-czf', '-', '-C', '/app/uploads', '.', output=output)
        shutil.copyfile(self.env_file, directory / 'deployment.env')
        os.chmod(directory / 'deployment.env', 0o600)
        return directory

    def apply(self, source):
        manifest = validate_package(source)
        current = self.current()
        if current and current['current'] == manifest['version']:
            if validate_package(self.folder(current['current'])) != manifest:
                raise ValueError('An existing release version cannot be replaced')
            print('Already running ' + manifest['version'])
            return None
        target = self.folder(manifest['version'])
        if target.exists():
            if validate_package(target) != manifest:
                raise ValueError('An existing release version cannot be replaced')
        else:
            target.mkdir(parents=True, mode=0o700)
            for name in (*FILES, 'manifest.json'):
                shutil.copyfile(Path(source) / name, target / name)
        self.compose(target, 'config', '--quiet')
        if not current:
            self.compose(target, 'pull', 'postgres')
        self.compose(target, 'pull', 'server', 'client')
        previous = current['current'] if current else None
        if previous:
            self.backup(self.folder(previous))
        try:
            self.promote(target)
        except RuntimeError:
            self.block(manifest['version'])
            if previous:
                self.promote(self.folder(previous))
                raise RuntimeError('Update failed; previous application release restored. Database was not reverted.')
            raise RuntimeError('Initial deployment failed. Data volumes were retained for inspection.')
        self.record(manifest['version'], previous)
        print('Running ' + manifest['version'])
        return manifest['version']

    def report_failure(self, message, now=None):
        """Notifies once per distinct failure, then again only after a day."""
        now = time.time() if now is None else now
        file = self.state / 'last-failure.json'
        try:
            last = json.loads(file.read_text())
        except (OSError, ValueError):
            last = {}
        if last.get('message') == message and now - last.get('at', 0) < REPEAT_FAILURE_AFTER:
            return False
        file.write_text(json.dumps({'message': message, 'at': now}))
        os.chmod(file, 0o600)
        return notify('Family Hub update failed', message, 'high', 'warning')

    def clear_failure(self):
        (self.state / 'last-failure.json').unlink(missing_ok=True)

    def restart(self):
        # Recreates the running release's containers so changed private settings
        # (for example sign-in with Google) take effect. Data volumes are kept.
        current = self.current()
        if not current:
            raise ValueError('No release is recorded')
        self.promote(self.folder(current['current']))
        print('Restarted ' + current['current'])

    def rollback(self):
        current = self.current()
        if not current or not current.get('previous'):
            raise ValueError('No previous release is recorded')
        self.backup(self.folder(current['current']))
        self.promote(self.folder(current['previous']))
        self.block(current['current'])
        self.record(current['previous'], current['current'])
        print('Previous application release restored; household data was not rewound.')
        notify('Family Hub rolled back', f"Now running {current['previous']}; {current['current']} is blocked from reinstalling.", 'high', 'rewind')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['apply', 'restart', 'rollback', 'update'])
    parser.add_argument('package', nargs='?', help='Extracted, trusted release directory for apply')
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--env-file', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    deployment = Deployment(args.state_dir, args.env_file)
    with (deployment.state / 'update.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'rollback':
            deployment.rollback()
        elif args.action == 'restart':
            deployment.restart()
        elif args.action == 'apply':
            if not args.package:
                raise ValueError('An extracted release directory is required')
            deployment.apply(args.package)
        else:
            # gh handles private-repository authentication and asset redirects.
            result = subprocess.run(['gh', 'release', 'list', '--repo', 'santoshgs/FamilyHub', '--limit', '30', '--json', 'tagName,isDraft,isPrerelease'], capture_output=True, check=True)
            releases = json.loads(result.stdout)
            release = newest_release(releases, deployment.blocked())
            if not release:
                raise ValueError('No stable Family Hub release is available')
            if deployment.current() and version_key(deployment.current()['current']) >= version_key(release):
                print('Already up to date')
                deployment.clear_failure()
                return
            with tempfile.TemporaryDirectory(prefix='release-', dir=deployment.state) as temp:
                subprocess.run(['gh', 'release', 'download', release, '--repo', 'santoshgs/FamilyHub', '--pattern', release + '.tar.gz', '--dir', temp], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
                folder = Path(temp) / 'package'
                folder.mkdir()
                unpack(Path(temp) / (release + '.tar.gz'), folder)
                installed = deployment.apply(folder)
            if installed:
                notify('Family Hub updated', f'Now running {installed}.', 'default', 'white_check_mark')
        deployment.clear_failure()


def describe(error):
    return str(error) if isinstance(error, (ValueError, RuntimeError)) else 'Check private configuration, authentication and local service status.'


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = describe(error)
        print('Family Hub deployment stopped: ' + message, file=sys.stderr)
        try:
            # Only the hourly updater reports; a person running a command sees the error.
            if 'update' in sys.argv[1:2]:
                state = sys.argv[sys.argv.index('--state-dir') + 1]
                env = sys.argv[sys.argv.index('--env-file') + 1]
                Deployment(state, env).report_failure(message)
        except Exception:
            pass
        sys.exit(1)
