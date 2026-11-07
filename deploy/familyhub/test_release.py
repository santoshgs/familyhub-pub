import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('familyhub_release', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = self.root / 'private.env'
        self.env.write_text('fictional configuration')
        self.env.chmod(0o600)
        self.deployment = release.Deployment(self.root / 'state', self.env)

    def tearDown(self):
        self.temp.cleanup()

    def package(self, version='familyhub-v0.1.0'):
        folder = self.root / version
        folder.mkdir()
        for name in release.FILES:
            (folder / name).write_text('fictional ' + name)
        manifest = {'schema': 1, 'version': version, 'rollbackSafe': True,
                    'serverImage': 'ghcr.io/santoshgs/familyhub-server@sha256:' + 'a' * 64,
                    'clientImage': 'ghcr.io/santoshgs/familyhub-client@sha256:' + 'b' * 64,
                    'files': {name: hashlib.sha256((folder / name).read_bytes()).hexdigest() for name in release.FILES}}
        (folder / 'manifest.json').write_text(json.dumps(manifest))
        return folder

    def test_rejects_mutable_images_tampering_and_unsafe_schema(self):
        folder = self.package()
        manifest = release.validate_package(folder)
        (folder / 'images.yml').write_text('tampered')
        with self.assertRaises(ValueError):
            release.validate_package(folder)
        for change in [{'rollbackSafe': False}, {'serverImage': 'ghcr.io/santoshgs/familyhub-server:latest'}]:
            (folder / 'manifest.json').write_text(json.dumps(dict(manifest, **change)))
            with self.assertRaises(ValueError):
                release.validate_package(folder)

    def test_failed_upgrade_restores_previous_app_without_advancing_state(self):
        first, second = self.package(), self.package('familyhub-v0.2.0')
        with patch.object(self.deployment, 'compose'), patch.object(self.deployment, 'backup') as backup, patch.object(self.deployment, 'promote') as promote:
            self.deployment.apply(first)
            promote.reset_mock()
            promote.side_effect = [RuntimeError('fictional health failure'), None]
            with self.assertRaisesRegex(RuntimeError, 'previous application release restored'):
                self.deployment.apply(second)
            backup.assert_called_once()
            self.assertEqual(promote.call_args_list[-1].args[0].name, 'familyhub-v0.1.0')
            self.assertEqual(self.deployment.current()['current'], 'familyhub-v0.1.0')
            self.assertIn('familyhub-v0.2.0', self.deployment.blocked())

    def test_manual_rollback_and_idempotent_reapply(self):
        first, second = self.package(), self.package('familyhub-v0.2.0')
        with patch.object(self.deployment, 'compose'), patch.object(self.deployment, 'backup'), patch.object(self.deployment, 'promote') as promote:
            self.deployment.apply(first)
            self.deployment.apply(first)
            self.assertEqual(promote.call_count, 1)
            self.deployment.apply(second)
            self.deployment.rollback()
            self.assertEqual(self.deployment.current()['current'], 'familyhub-v0.1.0')

    def test_restart_recreates_the_running_release(self):
        first = self.package()
        with patch.object(self.deployment, 'compose'), patch.object(self.deployment, 'backup'), patch.object(self.deployment, 'promote') as promote:
            with self.assertRaises(ValueError):
                self.deployment.restart()
            self.deployment.apply(first)
            promote.reset_mock()
            self.deployment.restart()
            self.assertEqual(promote.call_args.args[0].name, 'familyhub-v0.1.0')
            self.assertEqual(self.deployment.current()['current'], 'familyhub-v0.1.0')

    def test_apply_reports_only_a_newly_installed_version(self):
        first = self.package()
        with patch.object(self.deployment, 'compose'), patch.object(self.deployment, 'backup'), patch.object(self.deployment, 'promote'):
            self.assertEqual(self.deployment.apply(first), 'familyhub-v0.1.0')
            self.assertIsNone(self.deployment.apply(first))

    def test_repeated_failures_notify_once_a_day(self):
        with patch.object(release, 'notify', return_value=True) as sent:
            self.assertTrue(self.deployment.report_failure('fictional failure', now=1000))
            self.assertFalse(self.deployment.report_failure('fictional failure', now=2000))
            self.assertTrue(self.deployment.report_failure('another fictional failure', now=3000))
            self.assertTrue(self.deployment.report_failure('another fictional failure', now=3000 + release.REPEAT_FAILURE_AFTER))
            self.deployment.clear_failure()
            self.assertTrue(self.deployment.report_failure('another fictional failure', now=3000 + release.REPEAT_FAILURE_AFTER + 1))
            self.assertEqual(sent.call_count, 4)

    def test_notify_settings_need_https_and_never_raise(self):
        settings_file = self.root / 'notify.env'
        settings_file.write_text('NTFY_URL=http://ntfy.example.test/topic\n')
        self.assertEqual(release.read_notify_settings([str(settings_file)]), {})
        settings_file.write_text('# fictional\nNTFY_URL="https://ntfy.example.test/fictional-topic"\nNTFY_TOKEN=tk_fictional\n')
        self.assertEqual(release.read_notify_settings([str(settings_file), '/nonexistent']),
                         {'NTFY_URL': 'https://ntfy.example.test/fictional-topic', 'NTFY_TOKEN': 'tk_fictional'})
        self.assertFalse(release.notify('t', 'm', settings={}))
        with patch.object(release.urllib.request, 'urlopen', side_effect=OSError('offline')):
            self.assertFalse(release.notify('t', 'm', settings={'NTFY_URL': 'https://ntfy.example.test/x'}))

    def test_rejects_archive_traversal(self):
        archive = self.root / 'unsafe.tar.gz'
        with tarfile.open(archive, 'w:gz') as out:
            entry = tarfile.TarInfo('../escape')
            entry.size = 4
            out.addfile(entry, io.BytesIO(b'fake'))
        with self.assertRaises(ValueError):
            release.unpack(archive, self.root)
        self.assertFalse((self.root.parent / 'escape').exists())

    def test_backup_failure_never_promotes_the_new_release(self):
        first, second = self.package(), self.package('familyhub-v0.2.0')
        with patch.object(self.deployment, 'compose'), patch.object(self.deployment, 'backup') as backup, patch.object(self.deployment, 'promote') as promote:
            self.deployment.apply(first)
            promote.reset_mock()
            backup.side_effect = RuntimeError('fictional backup failure')
            with self.assertRaises(RuntimeError):
                self.deployment.apply(second)
            promote.assert_not_called()
            self.assertEqual(self.deployment.current()['current'], 'familyhub-v0.1.0')

    def test_update_selection_uses_semver_and_skips_failed_draft_and_prerelease_versions(self):
        releases = [{'tagName': name, 'isDraft': False, 'isPrerelease': False} for name in ['v9.0.0', 'familyhub-v0.2.0', 'familyhub-v0.10.0', 'familyhub-v0.3.0']]
        releases += [{'tagName': 'familyhub-v1.0.0', 'isDraft': True, 'isPrerelease': False}]
        self.assertEqual(release.newest_release(releases, ['familyhub-v0.10.0']), 'familyhub-v0.3.0')
        self.assertGreater(release.version_key('familyhub-v0.10.0'), release.version_key('familyhub-v0.9.0'))

    def stable(self, *names):
        return [{'tagName': name, 'isDraft': False, 'isPrerelease': False} for name in names]

    def test_check_records_and_publishes_whether_an_update_is_available(self):
        exchange = self.root / 'exchange'
        exchange.mkdir()
        with patch.object(self.deployment, 'compose'), patch.object(self.deployment, 'backup'), patch.object(self.deployment, 'promote'):
            self.deployment.apply(self.package())
        with patch.object(release, 'list_releases', return_value=self.stable('familyhub-v0.1.0', 'familyhub-v0.2.0')), \
                patch.object(release, 'timer_enabled', return_value=True):
            self.deployment.check(exchange)
        published = json.loads((exchange / release.STATUS_FILE).read_text())
        self.assertEqual(published, json.loads((self.deployment.state / release.STATUS_FILE).read_text()))
        self.assertEqual({k: published[k] for k in ('current', 'latest', 'updateAvailable', 'state', 'autoUpdates')},
                         {'current': 'familyhub-v0.1.0', 'latest': 'familyhub-v0.2.0', 'updateAvailable': True, 'state': 'checked', 'autoUpdates': True})
        self.assertEqual((exchange / release.STATUS_FILE).stat().st_mode & 0o777, 0o644)
        self.assertEqual((self.deployment.state / release.STATUS_FILE).stat().st_mode & 0o777, 0o600)
        with patch.object(release, 'list_releases', return_value=self.stable('familyhub-v0.1.0')), patch.object(release, 'timer_enabled', return_value=False):
            self.deployment.check(exchange)
        self.assertFalse(json.loads((exchange / release.STATUS_FILE).read_text())['updateAvailable'])

    def test_published_status_replaces_a_planted_symlink_without_following_it(self):
        exchange = self.root / 'exchange'
        exchange.mkdir()
        victim = self.root / 'victim.txt'
        victim.write_text('keep me')
        (exchange / release.STATUS_FILE).symlink_to(victim)
        self.deployment.write_status(exchange, state='checked', latest=None)
        self.assertEqual(victim.read_text(), 'keep me')
        self.assertFalse((exchange / release.STATUS_FILE).is_symlink())
        self.assertFalse(json.loads((exchange / release.STATUS_FILE).read_text())['updateAvailable'])

    def test_start_update_only_starts_the_updater_unit(self):
        with patch.object(release.subprocess, 'run') as run, patch.object(release, 'timer_enabled', return_value=True):
            self.deployment.start_update()
        run.assert_called_once()
        self.assertEqual(run.call_args.args[0], ['systemctl', 'start', '--no-block', release.UPDATE_UNIT])
        self.assertEqual(self.deployment.status()['state'], 'installing')

    def test_status_never_raises_and_ignores_a_bad_latest_value(self):
        data = self.deployment.write_status(None, latest='../../etc/passwd')
        self.assertFalse(data['updateAvailable'])
        self.assertIsNone(self.deployment.write_status(self.root / 'missing-dir', state='checked'))


if __name__ == '__main__':
    unittest.main()
