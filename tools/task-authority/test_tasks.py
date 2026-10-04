import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from tasks import Store, RequestError, canonical


def inventory():
    return [
        {'table': 'clients', 'id': 'c', 'value': {'id': 'c', 'name': 'Client'}},
        {'table': 'projects', 'id': 'p', 'value': {'id': 'p', 'name': 'Project', 'clientId': 'c'}},
        {'table': 'tasks', 'id': 't', 'value': {'id': 't', 'title': 'Teklifi hazırla', 'content': '{"type":"doc"}',
         'status': 'pending', 'importance': 'medium', 'date': '2026-09-27', 'projectId': 'p',
         'assignees': [], 'createdAt': 1, 'updatedAt': 1}},
        {'table': 'taskComments', 'id': 'm', 'value': {'id': 'm', 'taskId': 't', 'text': 'Keep',
         'attachmentDataUrl': 'data:text/plain;base64,aGVsbG8=', 'attachmentName': 'note.txt'}}]


class AuthorityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = Store(self.root)

    def bootstrap(self):
        self.request = {'schema': 1, 'action': 'bootstrap', 'actor': 'fixture',
                        'operationId': 'import-1', 'records': inventory()}
        return self.store.rpc(self.request)

    def update(self, snapshot, title, operation='change-1', revision=1):
        task = next(r for r in snapshot['records'] if r['table'] == 'tasks')['value']
        return {'schema': 1, 'action': 'sync', 'actor': 'hermes', 'operationId': operation,
                'databaseId': snapshot['databaseId'], 'changes': [
                {'table': 'tasks', 'id': 't', 'expectedRevision': revision, 'value': dict(task, title=title)}]}

    def test_absent_status_does_not_initialize_storage(self):
        self.assertFalse(self.store.rpc({'schema': 1, 'action': 'snapshot'})['snapshot']['initialized'])
        self.assertFalse(self.store.path.exists())

    def test_lossless_import_and_duplicate_retry(self):
        initial = self.bootstrap()
        retried = self.store.rpc(self.request)
        self.assertTrue(retried['duplicate'])
        self.assertEqual(initial['snapshot'], retried['snapshot'])
        original = json.loads((self.store.state / 'initial-import.json').read_bytes())
        self.assertEqual(original['records'], inventory())
        actual = {r['id']: r['value'] for r in initial['snapshot']['records']}
        self.assertEqual(actual, {r['id']: r['value'] for r in inventory()})

    def test_second_import_cannot_replace_existing_authority(self):
        self.bootstrap()
        with self.assertRaises(RequestError):
            self.store.rpc(dict(self.request, operationId='different-import'))

    def test_large_attachment_is_not_duplicated_in_the_wire_receipt(self):
        records = inventory()
        records[-1]['value']['attachmentDataUrl'] = 'data:text/plain;base64,' + 'a' * 10000
        request = {'schema': 1, 'action': 'bootstrap', 'actor': 'fixture',
                   'operationId': 'large-import', 'records': records}
        with patch('tasks.MAX_BYTES', 15000):
            result = self.store.rpc(request)
            self.assertTrue(result['snapshot']['initialized'])
            self.assertLess(len(canonical(result).encode()), 15000)
            self.assertTrue(all(r.get('valueFromSnapshot') for r in result['applied']))
            self.assertEqual(result['snapshot']['records'][-1]['value'], records[2]['value'])
            self.assertTrue(self.store.rpc(request)['duplicate'])

    def test_retried_receipt_keeps_old_value_when_snapshot_has_a_newer_revision(self):
        snapshot = self.bootstrap()['snapshot']
        self.store.rpc(self.update(snapshot, 'changed after import'))
        retry = self.store.rpc(self.request)
        old = next(r for r in retry['applied'] if r['id'] == 't')
        self.assertEqual(old['revision'], 1)
        self.assertEqual(old['value'], inventory()[2]['value'])
        current = next(r for r in retry['snapshot']['records'] if r['id'] == 't')
        self.assertEqual(current['revision'], 2)

    def test_revision_conflict_preserves_both_authority_and_history(self):
        snapshot = self.bootstrap()['snapshot']
        first = self.store.rpc(self.update(snapshot, 'Hermes edit'))
        failed = self.store.rpc(self.update(snapshot, 'Offline edit', 'change-2'))
        self.assertEqual(failed['outcome'], 'conflict')
        self.assertEqual(first['snapshot'], failed['snapshot'])
        self.assertEqual(self.store.rpc(self.update(snapshot, 'Hermes edit'))['snapshot']['records'], first['snapshot']['records'])

    def test_changed_payload_cannot_reuse_operation_identity(self):
        snapshot = self.bootstrap()['snapshot']
        self.store.rpc(self.update(snapshot, 'first'))
        with self.assertRaises(RequestError):
            self.store.rpc(self.update(snapshot, 'different'))

    def test_atomic_relations_and_subtasks(self):
        snapshot = self.bootstrap()['snapshot']
        bad = self.update(snapshot, 'bad')
        bad['changes'][0]['value']['projectId'] = 'missing'
        with self.assertRaises(RequestError):
            self.store.rpc(bad)
        self.assertEqual(self.store.rpc({'schema': 1, 'action': 'snapshot'})['snapshot'], snapshot)
        child = dict(inventory()[2]['value'], id='child', parentTaskId='t')
        good = dict(bad, operationId='subtask', changes=[
            {'table': 'tasks', 'id': 'child', 'expectedRevision': None, 'value': child}])
        self.assertEqual(self.store.rpc(good)['outcome'], 'applied')

    def test_hard_delete_keeps_tombstone_and_cannot_silently_recreate(self):
        snapshot = self.bootstrap()['snapshot']
        delete = self.update(snapshot, 'unused')
        delete['changes'][0]['value'] = None
        result = self.store.rpc(delete)
        row = next(r for r in result['snapshot']['records'] if r['id'] == 't')
        self.assertIsNone(row['value'])
        stale_create = self.update(snapshot, 'resurrect', 'create-again', None)
        self.assertEqual(self.store.rpc(stale_create)['outcome'], 'conflict')

    def test_backup_restores_full_authority_and_deduplication(self):
        snapshot = self.bootstrap()['snapshot']
        request = self.update(snapshot, 'VPS while desktop is off')
        final = self.store.rpc(request)
        restored_root = self.root / 'restored'
        (restored_root / '.state').mkdir(parents=True)
        self.store.checkpoint(restored_root / '.state/tasks.sqlite3')
        restored = Store(restored_root)
        self.assertEqual(restored.rpc({'schema': 1, 'action': 'snapshot'})['snapshot'], final['snapshot'])
        self.assertTrue(restored.rpc(request)['duplicate'])
        with closing(sqlite3.connect(restored.path)) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def test_wrong_authority_identity_is_refused(self):
        snapshot = self.bootstrap()['snapshot']
        request = self.update(snapshot, 'bad')
        request['databaseId'] = 'different-server'
        with self.assertRaises(RequestError):
            self.store.rpc(request)


if __name__ == '__main__':
    unittest.main()
