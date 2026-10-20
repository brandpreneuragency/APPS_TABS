"""Synthetic fixtures only; no native credentials read by tests."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('collector.py'))
assert spec is not None and spec.loader is not None
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class IdentityTests(unittest.TestCase):
    def test_identity_uses_principal_and_workspace_not_email(self):
        a = c.identity({'accountId': 'workspace', 'email': 'display@example.test'})
        self.assertIsNone(a['key'])
        self.assertEqual(a['workspaceId'], 'workspace')
        self.assertEqual(a['email'], 'display@example.test')

class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR'))
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def jwt(self, user='principal', workspace='workspace'):
        import base64
        value = {'email': 'display@example.test', c.AUTH_NS: {'chatgpt_user_id': user, 'chatgpt_account_id': workspace, 'chatgpt_plan_type': 'plus'}}
        part = base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
        return 'eyJmaXh0dXJlIjp0cnVlfQ.' + part + '.synthetic'

    def save(self, value, name='auth.json'):
        path = self.root / name
        path.write_text(json.dumps(value))
        return path

    def test_claim_key_matches_native_and_no_token_leaves_output(self):
        import hashlib
        token = self.jwt()
        result = c.identity({'access_token': token})
        expected = hashlib.sha256(b'["openai-codex","principal","workspace"]').hexdigest()
        self.assertEqual(result['key'], expected)
        self.assertNotIn(token, json.dumps(result))
        self.assertEqual(set(result), {'key', 'email', 'workspaceId', 'plan'})

    def test_conflicting_explicit_workspace_drops_identity(self):
        self.assertIsNone(c.identity({'access': self.jwt(), 'accountId': 'different'}))

    def test_duplicate_pool_and_singleton_agree(self):
        row = {'access_token': self.jwt()}
        path = self.save({'providers': {'openai-codex': {'tokens': row}}, 'credential_pool': {'openai-codex': [row, row]}})
        result = c.hermes(path, 'hermes-mother')
        self.assertEqual(result['evidence'], 'configured')
        self.assertEqual(result['error'], 'runtimeUnverified')
        self.assertIsNotNone(result['identity']['key'])

    def test_distinct_and_unknown_candidates_are_ambiguous(self):
        for second in ({'access_token': self.jwt('other')}, {'access_token': 'synthetic-opaque'}, None):
            path = self.save({'credential_pool': {'openai-codex': [{'access_token': self.jwt()}, second]}})
            result = c.hermes(path, 'hermes-vps')
            self.assertEqual(result['error'], 'multipleConfiguredAccounts')
            self.assertIsNone(result['identity'])

    def db(self, rows):
        import sqlite3
        path = self.root / 'opencode.db'
        con = sqlite3.connect(path)
        con.execute('CREATE TABLE credential(id TEXT,label TEXT,active INTEGER,value TEXT,integration_id TEXT,time_created INTEGER)')
        for number, active, row in rows:
            con.execute('INSERT INTO credential VALUES(?,?,?,?,?,?)', (str(number), 'fixture', active, json.dumps(row), 'openai', number))
        con.commit()
        con.close()
        return path

    def test_v2_active_wins_over_stale_v1_and_database_unchanged(self):
        import hashlib
        self.save({'openai': {'type': 'oauth', 'access': self.jwt('stale')}})
        db = self.db([(1, 0, {'type': 'oauth', 'access': self.jwt('old')}), (2, 1, {'type': 'oauth', 'access': self.jwt()})])
        before = (db.read_bytes(), db.stat().st_mtime_ns, set(self.root.iterdir()))
        result = c.opencode(self.root, 'opencode-mother')
        self.assertEqual(result['identity']['key'], c.identity({'access': self.jwt()})['key'])
        self.assertEqual(result['evidence'], 'configured')
        self.assertEqual(before, (db.read_bytes(), db.stat().st_mtime_ns, set(self.root.iterdir())))

    def test_v2_empty_does_not_fall_back_to_v1(self):
        self.save({'openai': {'type': 'oauth', 'access': self.jwt()}})
        self.db([])
        self.assertEqual(c.opencode(self.root, 'opencode-vps')['error'], 'notConfigured')

    def test_v2_missing_active_or_duplicate_active_never_guesses(self):
        for states in ((0,), (1, 1)):
            with self.subTest(states=states):
                db = self.db([(number, active, {'type': 'oauth', 'access': self.jwt()}) for number, active in enumerate(states)])
                self.assertEqual(c.opencode(self.root, 'opencode-mother')['error'], 'multipleConfiguredAccounts')
                db.unlink()  # fixture file created by this test only

    def test_v1_metadata_retained_without_claiming_stable_key(self):
        self.save({'openai': {'type': 'oauth', 'accountId': 'workspace', 'email': 'display@example.test'}})
        result = c.opencode(self.root, 'opencode-mother')
        self.assertIsNone(result['identity']['key'])
        self.assertEqual(result['identity']['workspaceId'], 'workspace')

    def test_missing_corrupt_unsupported_and_failure_isolation(self):
        self.assertEqual(c.hermes(self.root/'missing', 'hermes-mother')['error'], 'notConfigured')
        (self.root/'auth.json').write_text('{')
        self.assertEqual(c.hermes(self.root/'auth.json', 'hermes-mother')['error'], 'sourceUnavailable')
        self.db([(1, 1, {'type':'oauth', 'access': self.jwt()})])
        self.assertIsNotNone(c.opencode(self.root, 'opencode-mother')['identity'])
        (self.root/'opencode.db').write_bytes(b'not sqlite')
        self.assertEqual(c.opencode(self.root, 'opencode-mother')['error'], 'unsupportedStore')

    def test_live_uncertainty_and_override_do_not_read_stores(self):
        for kwargs, reason in [({'runtime_ambiguous': True}, 'runtimeStoreAmbiguous'), ({'override': True}, 'sourceUnavailable')]:
            result = c.opencode(self.root, 'opencode-vps', **kwargs)
            self.assertEqual(result['error'], reason)
            self.assertIsNone(result['identity'])
            self.assertEqual(result['evidence'], 'unavailable')

    def test_malformed_jwt_and_unknown_identity_never_become_runtime(self):
        path = self.save({'credential_pool': {'openai-codex': [{'access_token':'not.a.jwt'}]}})
        result = c.hermes(path, 'hermes-mother')
        self.assertEqual(result['error'], 'identityUnavailable')
        self.assertIsNone(result['identity'])
        self.assertEqual(result['evidence'], 'configured')

if __name__ == '__main__':
    unittest.main()
