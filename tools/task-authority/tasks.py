#!/usr/bin/env python3
"""Owner-operated ATLAS task authority. JSON RPC over existing SSH; no listener.

Only clients/projects/tasks/taskComments are stored. SQLite is opened on the
VPS itself, never through V:, SMB or another mounted filesystem. All changes
use revision checks, idempotent operation IDs and an append-only change log.
"""
import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import uuid

TABLES = ('clients', 'projects', 'tasks', 'taskComments')
MAX_BYTES = 64 * 1024 * 1024
MAX_RECORDS = 100000


class RequestError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def bounded(result):
    # Receipts retain full values in SQLite. On the wire, reuse the exact
    # snapshot revision instead of sending large attachments a second time.
    # A retry after a later edit still carries the original committed value.
    if result.get('applied'):
        indexed = {(r['table'], r['id']): r for r in result['snapshot']['records'] or []}
        result = dict(result, applied=[
            {'table': r['table'], 'id': r['id'], 'revision': r['revision'], 'valueFromSnapshot': True}
            if indexed.get((r['table'], r['id'])) == r else r
            for r in result['applied']])
    if len(canonical(result).encode('utf-8')) > MAX_BYTES:
        raise RequestError('Task response exceeds the transport limit; no change was committed')
    return result


def identifier(value):
    if not isinstance(value, str) or not value or len(value) > 250 or any(ord(c) < 32 for c in value):
        raise RequestError('Invalid record identity')
    return value


def checked_path(path):
    path = Path(path).absolute()
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise RequestError('Symbolic links are not supported for task storage')
    return path


def validate_record(table, record_id, value):
    if table not in TABLES:
        raise RequestError('Unsupported task table')
    identifier(record_id)
    if value is None:
        return
    if not isinstance(value, dict) or value.get('id') != record_id:
        raise RequestError('Record identity mismatch')
    canonical(value)  # reject non-JSON/non-finite values; retain unknown existing fields
    if table in ('clients', 'projects'):
        if not isinstance(value.get('name'), str) or not value['name'].strip():
            raise RequestError('A client/project name is required')
    if table == 'projects':
        identifier(value.get('clientId'))
    if table == 'tasks':
        if not isinstance(value.get('title'), str) or not value['title'].strip():
            raise RequestError('A task title is required')
        if value.get('status') not in ('pending', 'in_progress', 'completed'):
            raise RequestError('Invalid task status')
        if value.get('importance') not in ('low', 'medium', 'high'):
            raise RequestError('Invalid task importance')
        if not isinstance(value.get('content'), str) or not isinstance(value.get('assignees'), list):
            raise RequestError('Task content and assignees must retain their TABS types')
        if not isinstance(value.get('date'), str):
            raise RequestError('Task date must retain its TABS string value')
        identifier(value.get('projectId'))
    if table == 'taskComments':
        identifier(value.get('taskId'))
        if not isinstance(value.get('text'), str):
            raise RequestError('Comment text is required')


def validate_graph(records):
    """Retain historic deleted/orphaned records, refuse broken active relations."""
    for project in records['projects'].values():
        if project['clientId'] not in records['clients']:
            raise RequestError('Project client is missing')
    for task in records['tasks'].values():
        if task.get('deletedAt'):
            continue
        if task['projectId'] not in records['projects']:
            raise RequestError('Active task project is missing')
        parent_id = task.get('parentTaskId')
        if parent_id:
            parent = records['tasks'].get(parent_id)
            if (not parent or parent.get('deletedAt') or parent.get('parentTaskId')
                    or parent['id'] == task['id'] or parent['projectId'] != task['projectId']):
                raise RequestError('Invalid subtask relationship')


class Store:
    def __init__(self, root):
        self.root = checked_path(root)
        if not self.root.is_dir():
            raise RequestError('Resolve an existing TASKS root first')
        self.state = checked_path(self.root / '.state')
        self.path = checked_path(self.state / 'tasks.sqlite3')

    @contextmanager
    def connect(self, create=False):
        if not create and not self.path.exists():
            yield None
            return
        self.state.mkdir(mode=0o700, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=15, isolation_level=None)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute('PRAGMA synchronous=FULL')
            connection.executescript('''
              CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS records (
                kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
                data TEXT, PRIMARY KEY(kind,id));
              CREATE TABLE IF NOT EXISTS operations (
                id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, outcome TEXT NOT NULL,
                applied TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS history (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT, generation INTEGER NOT NULL,
                kind TEXT NOT NULL, id TEXT NOT NULL, before_data TEXT, after_data TEXT,
                operation_id TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL);
            ''')
            if os.name == 'posix':
                os.chmod(self.path, 0o600)
            connection.execute('BEGIN IMMEDIATE')
            try:
                yield connection
                connection.commit()
            except BaseException:
                connection.rollback()
                raise

    def snapshot(self, connection):
        meta = dict(connection.execute('SELECT key,value FROM meta')) if connection else {}
        if not meta.get('databaseId'):
            return {'schema': 1, 'initialized': False, 'databaseId': None, 'generation': 0, 'records': []}
        records = [{'table': row['kind'], 'id': row['id'], 'revision': row['revision'],
                    'value': json.loads(row['data']) if row['data'] is not None else None}
                   for row in connection.execute('SELECT * FROM records ORDER BY kind,id')]
        activity = [{'operationId': row['id'], 'actor': row['actor'], 'at': row['at'],
                     'outcome': row['outcome'], 'count': len(json.loads(row['applied']))}
                    for row in connection.execute('SELECT * FROM operations ORDER BY rowid DESC LIMIT 20')]
        return {'schema': 1, 'initialized': True, 'databaseId': meta['databaseId'],
                'generation': int(meta['generation']), 'records': records, 'activity': activity}

    def rpc(self, request):
        if not isinstance(request, dict) or request.get('schema') != 1:
            raise RequestError('Unsupported request schema')
        action = request.get('action')
        if action not in ('snapshot', 'bootstrap', 'sync'):
            raise RequestError('Unsupported task action')
        if action == 'snapshot':
            with self.connect() as connection:
                result = self.snapshot(connection)
                if (result['initialized'] and request.get('databaseId') == result['databaseId']
                        and request.get('generation') == result['generation']):
                    result['records'] = None
                return bounded({'outcome': 'snapshot', 'snapshot': result})
        operation_id = identifier(request.get('operationId'))
        actor = identifier(request.get('actor'))
        fingerprint = hashlib.sha256(canonical(request).encode()).hexdigest()
        with self.connect(create=action == 'bootstrap') as connection:
            if connection is None:
                raise RequestError('Import the existing TABS tasks before making changes')
            prior = connection.execute('SELECT * FROM operations WHERE id=?', (operation_id,)).fetchone()
            if prior:
                if prior['payload_hash'] != fingerprint:
                    raise RequestError('Operation ID was reused with different data')
                return bounded({'outcome': prior['outcome'], 'applied': json.loads(prior['applied']),
                        'snapshot': self.snapshot(connection), 'duplicate': True})
            current = self.snapshot(connection)
            if action == 'bootstrap':
                if current['initialized']:
                    raise RequestError('VPS task authority is already initialized; it will not be overwritten')
                rows = request.get('records')
                if not isinstance(rows, list) or len(rows) > MAX_RECORDS:
                    raise RequestError('Invalid initial task inventory')
                changes = []
                for row in rows:
                    if not isinstance(row, dict) or set(row) != {'table', 'id', 'value'} or row['value'] is None:
                        raise RequestError('Invalid initial task record')
                    changes.append(dict(row, expectedRevision=None))
            else:
                if request.get('databaseId') != current['databaseId']:
                    raise RequestError('Task authority identity changed; preserve the local cache')
                changes = request.get('changes')
                if not isinstance(changes, list) or len(changes) > MAX_RECORDS:
                    raise RequestError('Invalid change list')
            state = {name: {} for name in TABLES}
            indexed = {}
            for row in current['records']:
                indexed[(row['table'], row['id'])] = row
                if row['value'] is not None:
                    state[row['table']][row['id']] = row['value']
            seen, conflicts = set(), []
            for change in changes:
                if not isinstance(change, dict) or set(change) != {'table', 'id', 'value', 'expectedRevision'}:
                    raise RequestError('Invalid task change')
                kind, record_id, value = change['table'], change['id'], change['value']
                validate_record(kind, record_id, value)
                key = (kind, record_id)
                if key in seen:
                    raise RequestError('Duplicate record in the same operation')
                seen.add(key)
                expected = change['expectedRevision']
                if expected is not None and (type(expected) is not int or expected < 1):
                    raise RequestError('Invalid expected revision')
                if expected != indexed.get(key, {}).get('revision'):
                    conflicts.append({'table': kind, 'id': record_id})
                if value is None:
                    state[kind].pop(record_id, None)
                else:
                    state[kind][record_id] = value
            if conflicts:
                connection.execute('INSERT INTO operations VALUES (?,?,?,?,?,?)',
                    (operation_id, fingerprint, 'conflict', '[]', actor, stamp()))
                return bounded({'outcome': 'conflict', 'applied': [], 'conflicts': conflicts, 'snapshot': current})
            validate_graph(state)
            if action == 'bootstrap':
                # Keep the exact initial task-only records for recovery; no app credentials.
                original = checked_path(self.state / 'initial-import.json')
                body = canonical({'schema': 1, 'operationId': operation_id, 'records': rows}).encode('utf-8')
                if original.exists():
                    if original.read_bytes() != body:
                        raise RequestError('An earlier import recovery file needs inspection')
                else:
                    with original.open('xb') as stream:
                        stream.write(body)
                        stream.flush()
                        os.fsync(stream.fileno())
                connection.execute('INSERT INTO meta VALUES (?,?)', ('databaseId', str(uuid.uuid4())))
                connection.execute('INSERT INTO meta VALUES (?,?)', ('generation', '0'))
            generation = current['generation'] + 1
            applied = []
            for change in changes:
                key = (change['table'], change['id'])
                before = indexed.get(key)
                revision = (before['revision'] if before else 0) + 1
                value = change['value']
                encoded = canonical(value) if value is not None else None
                connection.execute('INSERT OR REPLACE INTO records VALUES (?,?,?,?)',
                    (key[0], key[1], revision, encoded))
                connection.execute('INSERT INTO history (generation,kind,id,before_data,after_data,operation_id,actor,at) VALUES (?,?,?,?,?,?,?,?)',
                    (generation, key[0], key[1], canonical(before['value']) if before else None,
                     encoded, operation_id, actor, stamp()))
                applied.append({'table': key[0], 'id': key[1], 'revision': revision, 'value': value})
            connection.execute('UPDATE meta SET value=? WHERE key=?', (str(generation), 'generation'))
            connection.execute('INSERT INTO operations VALUES (?,?,?,?,?,?)',
                (operation_id, fingerprint, 'applied', canonical(applied), actor, stamp()))
            return bounded({'outcome': 'applied', 'applied': applied, 'snapshot': self.snapshot(connection)})

    def checkpoint(self, destination):
        target = checked_path(destination)
        if target.exists() or not self.path.exists():
            raise RequestError('Checkpoint needs an existing authority and a new destination')
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with closing(sqlite3.connect(self.path)) as source, closing(sqlite3.connect(target)) as output:
            source.backup(output)
            if output.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RequestError('Checkpoint integrity check failed')
        return {'checkpoint': str(target), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}


def main():
    if os.name == 'posix':
        os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('rpc')
    sub.add_parser('status')
    read = sub.add_parser('list')
    read.add_argument('--project')
    read.add_argument('--limit', type=int, default=50)
    get = sub.add_parser('get')
    get.add_argument('id')
    checkpoint = sub.add_parser('checkpoint')
    checkpoint.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    try:
        store = Store(args.root)
        if args.command == 'rpc':
            body = sys.stdin.buffer.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise RequestError('Task request exceeds the 64 MiB transport limit')
            result = store.rpc(json.loads(body))
        elif args.command == 'checkpoint':
            result = store.checkpoint(args.destination)
        else:
            snapshot = store.rpc({'schema': 1, 'action': 'snapshot'})['snapshot']
            records = snapshot.pop('records')
            if args.command == 'status':
                result = dict(snapshot, counts={name: sum(r['table'] == name and r['value'] is not None for r in records) for name in TABLES})
            elif args.command == 'get':
                matches = [r for r in records if r['table'] == 'tasks' and r['id'] == args.id]
                result = {'databaseId': snapshot['databaseId'], 'task': matches[0] if matches else None}
            else:
                tasks = [r for r in records if r['table'] == 'tasks' and r['value'] and not r['value'].get('deletedAt')
                         and (not args.project or r['value']['projectId'] == args.project)]
                limit = max(1, min(args.limit, 500))
                result = {'databaseId': snapshot['databaseId'], 'generation': snapshot['generation'],
                          'tasks': [{'id': r['id'], 'revision': r['revision'], **{k: r['value'].get(k)
                                     for k in ('title', 'status', 'date', 'projectId')}} for r in tasks[:limit]],
                          'total': len(tasks), 'truncated': len(tasks) > limit}
        encoded = canonical(result).encode('utf-8')
        if len(encoded) > MAX_BYTES:
            raise RequestError('Task snapshot exceeds the 64 MiB transport limit; inspect attachments before continuing')
        sys.stdout.buffer.write(encoded + b'\n')
    except (ValueError, OSError, sqlite3.Error, KeyError, TypeError) as error:
        # No database rows, task bodies or credential-bearing process output in errors.
        reason = str(error) if isinstance(error, RequestError) else type(error).__name__
        print(json.dumps({'error': reason}))
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
