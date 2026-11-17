"""Offline tests for update-github-tokens.sh (fictional tokens, temp directories).

Run:  python3 -m unittest deploy/familyhub/admin/test_update_github_tokens.py

The script insists on root, so the behavioural tests are skipped for other users.
The applier and the renewal check are replaced by stubs; nothing touches the Pi.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('update-github-tokens.sh')
IS_ROOT = os.geteuid() == 0
TOKEN_A = 'fictional_release_token_0123456789'
TOKEN_B = 'fictional_image_token_9876543210'


@unittest.skipUnless(IS_ROOT, 'update-github-tokens.sh must run as root')
class UpdateGithubTokensTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.root.chmod(0o755)
        self.exchange = self.root / 'exchange'
        self.inbox = self.exchange / 'inbox'
        self.state = self.root / 'state'
        self.inbox.mkdir(parents=True)
        self.state.mkdir(mode=0o700)
        self.applied = self.root / 'applied.log'
        # Stub applier: records which submissions were present, as the real one would consume them.
        self.apply = self.root / 'apply.sh'
        self.apply.write_text(f'#!/usr/bin/env bash\nls "{self.inbox}" | sort > "{self.applied}"\n')
        self.apply.chmod(0o755)
        self.check = self.root / 'check.sh'
        self.check.write_text('#!/usr/bin/env bash\necho renewals-checked\n')
        self.check.chmod(0o755)

    def tearDown(self):
        self.temp.cleanup()

    def run_script(self, *lines, extra_env=None):
        env = {**os.environ, 'EXCHANGE': str(self.exchange), 'STATE_DIR': str(self.state),
               'APPLY': str(self.apply), 'CHECK': str(self.check)}
        env.update(extra_env or {})
        return subprocess.run(['bash', str(SCRIPT)], input=''.join(line + '\n' for line in lines),
                              capture_output=True, text=True, env=env, timeout=30)

    def write_results(self, payload):
        (self.state / 'results.json').write_text(json.dumps(payload))
        (self.state / 'results.json').chmod(0o600)

    def test_valid_submission_is_root_private_and_complete(self):
        self.write_results({'github-release': {'ok': True, 'message': 'Saved.'}, 'ghcr': {'ok': False, 'message': 'Rejected.'}})
        result = self.run_script(TOKEN_A, TOKEN_B)
        self.assertEqual(result.returncode, 0, result.stderr)
        for kind, token in (('github-release', TOKEN_A), ('ghcr', TOKEN_B)):
            file = self.inbox / f'{kind}.json'
            self.assertEqual(json.loads(file.read_text()), {'kind': kind, 'token': token})
            self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            self.assertEqual(file.stat().st_uid, 0)
        self.assertEqual(self.applied.read_text().split(), ['ghcr.json', 'github-release.json'])
        self.assertEqual([p.name for p in self.inbox.iterdir() if p.name.startswith('.')], [])
        self.assertIn('github-release: OK - Saved.', result.stdout)
        self.assertIn('ghcr: FAILED - Rejected.', result.stdout)
        self.assertIn('renewals-checked', result.stdout)
        self.assertNotIn(TOKEN_A, result.stdout + result.stderr)
        self.assertNotIn(TOKEN_B, result.stdout + result.stderr)

    def test_enter_keeps_current_tokens(self):
        result = self.run_script('', '')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(list(self.inbox.iterdir()), [])

    def test_a_planted_symlink_is_replaced_not_followed_or_truncated(self):
        victim = self.root / 'victim.txt'
        victim.write_text('keep me')
        (self.inbox / 'ghcr.json').symlink_to(victim)
        result = self.run_script('', TOKEN_B)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(victim.read_text(), 'keep me')
        self.assertFalse((self.inbox / 'ghcr.json').is_symlink())
        self.assertEqual(json.loads((self.inbox / 'ghcr.json').read_text())['token'], TOKEN_B)

    def test_a_planted_hardlink_target_is_not_truncated(self):
        victim = self.root / 'victim.txt'
        victim.write_text('keep me')
        os.link(victim, self.inbox / 'github-release.json')
        result = self.run_script(TOKEN_A, '')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(victim.read_text(), 'keep me')

    def test_a_symlinked_inbox_is_refused(self):
        elsewhere = self.root / 'elsewhere'
        elsewhere.mkdir()
        shutil.rmtree(self.inbox)
        self.inbox.symlink_to(elsewhere)
        result = self.run_script(TOKEN_A, '')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('refusing', result.stderr)
        self.assertEqual(list(elsewhere.iterdir()), [])
        self.assertFalse(self.applied.exists())

    def test_a_symlinked_exchange_is_refused(self):
        real = self.root / 'real'
        self.exchange.rename(real)
        self.exchange.symlink_to(real)
        result = self.run_script(TOKEN_A, '')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list((real / 'inbox').iterdir()), [])

    def test_a_missing_inbox_is_not_created(self):
        shutil.rmtree(self.inbox)
        result = self.run_script(TOKEN_A, '')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing', result.stderr)
        self.assertFalse(self.inbox.exists())

    def test_results_come_from_the_state_directory_not_the_exchange(self):
        (self.exchange / 'results.json').write_text(json.dumps({'ghcr': {'ok': True, 'message': 'forged by the container'}}))
        self.write_results({'ghcr': {'ok': False, 'message': 'genuine'}})
        result = self.run_script('', '')
        self.assertIn('ghcr: FAILED - genuine', result.stdout)
        self.assertNotIn('forged', result.stdout)

    def test_a_symlinked_results_file_is_not_followed(self):
        secret = self.root / 'secret.json'
        secret.write_text(json.dumps({'leak': {'ok': True, 'message': 'should never print'}}))
        (self.state / 'results.json').symlink_to(secret)
        result = self.run_script('', '')
        self.assertEqual(result.returncode, 0)
        self.assertNotIn('should never print', result.stdout)

    def test_a_writable_results_file_is_not_trusted(self):
        self.write_results({'ghcr': {'ok': True, 'message': 'tamperable'}})
        (self.state / 'results.json').chmod(0o666)
        result = self.run_script('', '')
        self.assertNotIn('tamperable', result.stdout)

    def test_non_root_exits_2(self):
        if not shutil.which('setpriv'):
            self.skipTest('setpriv not available')
        script = self.root / 'script.sh'
        shutil.copy(SCRIPT, script)
        script.chmod(0o755)
        result = subprocess.run(['setpriv', '--reuid=65534', '--regid=65534', '--clear-groups', 'bash', str(script)],
                                input='', capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 2)


@unittest.skipIf(IS_ROOT, 'covered by the root-run class in the same file')
class NonRootTests(unittest.TestCase):
    def test_non_root_exits_2(self):
        result = subprocess.run(['bash', str(SCRIPT)], input='', capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 2)


if __name__ == '__main__':
    unittest.main()
