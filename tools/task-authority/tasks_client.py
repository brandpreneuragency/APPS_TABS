#!/usr/bin/env python3
"""ATLAS task client for local/VPS Hermes. Replays saved sync requests over SSH."""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

MAX_BYTES = 64 * 1024 * 1024
RESOLVER = '/home/admin/.hermes/skills/atlas/atlas-map/scripts/resolve.sh'
REMOTE = ('atlas_paths="$(sh ' + RESOLVER + ')" && eval "$atlas_paths" && '
          'exec python3 -B "$ATLAS_TOOLS/atlas-tasks/tasks.py" --root "$ATLAS_TASKS" rpc')


def request(body, via='auto'):
    encoded = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(encoded) > MAX_BYTES:
        raise ValueError('Request exceeds the transport limit')
    if via == 'ssh' or via == 'auto' and os.name == 'nt':
        command = ['ssh', '-C', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o',
                   'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=1', 'admin@atlas-vps', REMOTE]
    else:
        mapping = {}
        output = subprocess.check_output(['sh', RESOLVER], text=True)
        for line in output.splitlines():
            pair = shlex.split(line)
            if len(pair) == 2 and pair[0] == 'export':
                key, value = pair[1].split('=', 1)
                mapping[key] = value
        command = ['python3', '-B', str(Path(mapping['ATLAS_TOOLS']) / 'atlas-tasks/tasks.py'),
                   '--root', mapping['ATLAS_TASKS'], 'rpc']
    result = subprocess.run(command, input=encoded, capture_output=True, timeout=90)
    if len(result.stdout) > MAX_BYTES:
        raise ValueError('Response exceeds the transport limit; keep the request for inspection')
    try:
        reply = json.loads(result.stdout)
    except ValueError as error:
        raise ValueError('Connection result unknown. Keep and retry the exact saved request.') from error
    if result.returncode or 'error' in reply:
        raise ValueError(reply.get('error', 'Connection failed; preserve the saved request'))
    return reply


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--via', choices=['auto', 'ssh', 'vps'], default='auto')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('status')
    listing = sub.add_parser('list')
    listing.add_argument('--project')
    listing.add_argument('--limit', type=int, default=50)
    get = sub.add_parser('get')
    get.add_argument('id')
    get.add_argument('--table', choices=['tasks', 'projects', 'clients', 'taskComments'], default='tasks')
    get.add_argument('--output', type=Path)
    snapshot = sub.add_parser('snapshot')
    snapshot.add_argument('--output', type=Path, required=True)
    apply = sub.add_parser('apply')
    apply.add_argument('request_file', type=Path)
    args = parser.parse_args()
    if args.command == 'apply':
        body = json.loads(args.request_file.read_text(encoding='utf-8-sig'))
        if body.get('schema') != 1 or body.get('action') != 'sync':
            raise ValueError('Only a saved revision-checked sync request can be applied')
        reply = request(body, args.via)
        result = {'outcome': reply['outcome'], 'databaseId': reply['snapshot']['databaseId'],
                  'generation': reply['snapshot']['generation'], 'duplicate': reply.get('duplicate', False),
                  'applied': [{'table': r['table'], 'id': r['id'], 'revision': r['revision']} for r in reply.get('applied', [])]}
        print(json.dumps(result, ensure_ascii=False))
        return 3 if result['outcome'] == 'conflict' else 0
    snapshot = request({'schema': 1, 'action': 'snapshot'}, args.via)['snapshot']
    records = snapshot['records']
    if args.command == 'status':
        result = {key: snapshot[key] for key in ['initialized', 'databaseId', 'generation']}
        result['counts'] = {table: sum(row['table'] == table and row['value'] is not None for row in records)
                            for table in ['clients', 'projects', 'tasks', 'taskComments']}
    elif args.command == 'get':
        result = {'databaseId': snapshot['databaseId'], 'generation': snapshot['generation'],
                  'record': next((row for row in records if row['table'] == args.table and row['id'] == args.id), None)}
    elif args.command == 'snapshot':
        result = snapshot
    else:
        tasks = [row for row in records if row['table'] == 'tasks' and row['value'] and not row['value'].get('deletedAt')
                 and (not args.project or row['value']['projectId'] == args.project)]
        result = {'tasks': [{'id': row['id'], 'revision': row['revision'], **{key: row['value'].get(key)
                   for key in ['title', 'status', 'date', 'projectId']}} for row in tasks[:max(1, min(500, args.limit))]], 'total': len(tasks)}
    output = getattr(args, 'output', None)
    if output:
        with output.open('x', encoding='utf-8') as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
        print(json.dumps({'saved': str(output)}, ensure_ascii=False))
    else:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.SubprocessError, KeyError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        raise SystemExit(2)
