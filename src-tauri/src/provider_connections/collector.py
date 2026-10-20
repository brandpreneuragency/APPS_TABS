"""Read-only, stdlib-only collector. Never import an application's auth helpers.
Only main() uses fixed native paths. Function path parameters are fixture seams,
not a command-line or Tauri surface. JWT payloads are unverified stored metadata,
not proof of a current session, token validity, or request routing.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time

MAX_FILE = 4 * 1024 * 1024
AUTH_NS = 'https://api.openai.com/auth'


def text(value):
    # Refuse control characters, JWT-like values and credential-shaped strings.
    if not isinstance(value, str) or not 0 < len(value) <= 254:
        return None
    if any(ord(x) < 32 or ord(x) == 127 for x in value):
        return None
    if value.startswith(('eyJ', 'sk-', 'Bearer ')):
        return None
    return value


def payload(value):
    if not isinstance(value, str) or len(value) > 32768:
        return {}
    try:
        part = value.split('.')[1]
        result = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))
        return result if isinstance(result, dict) else {}
    except (ValueError, IndexError, UnicodeError):
        return {}


def identity(row):
    if not isinstance(row, dict):
        return None
    metadata = row.get('metadata', {})
    metadata = metadata if isinstance(metadata, dict) else {}
    sources = [row, metadata]
    tokens = row.get('tokens', {})
    tokens = tokens if isinstance(tokens, dict) else {}
    principals, workspaces, emails, plans = set(), set(), set(), set()
    for source in sources:
        for key in ('accountId', 'accountID', 'account_id'):
            if text(source.get(key)):
                workspaces.add(source[key])
        if text(source.get('email')):
            emails.add(source['email'])
    for source in (row, tokens):
        for field in ('access_token', 'id_token', 'access', 'id'):
            claims = payload(source.get(field))
            auth = claims.get(AUTH_NS, {})
            if not isinstance(auth, dict):
                continue
            for key in ('chatgpt_user_id', 'user_id'):
                if text(auth.get(key)):
                    principals.add(auth[key])
            if text(auth.get('chatgpt_account_id')):
                workspaces.add(auth['chatgpt_account_id'])
            if text(claims.get('email')):
                emails.add(claims['email'])
            profile = claims.get('https://api.openai.com/profile', {})
            if isinstance(profile, dict) and text(profile.get('email')):
                emails.add(profile['email'])
            if text(auth.get('chatgpt_plan_type')):
                plans.add(auth['chatgpt_plan_type'])
    if len(principals) > 1 or len(workspaces) > 1:
        return None
    principal = next(iter(principals), None)
    workspace = next(iter(workspaces), None)
    email = next(iter(emails)) if len(emails) == 1 else None
    plan = next(iter(plans)) if len(plans) == 1 else None
    key = hashlib.sha256(json.dumps(['openai-codex', principal, workspace],
                                    separators=(',', ':'), ensure_ascii=False).encode()).hexdigest() if principal and workspace else None
    if not any((key, workspace, email, plan)):
        return None
    return dict(key=key, email=email, workspaceId=workspace, plan=plan)


def observation(location, configured=False, account=None, error=None):
    return dict(id=location, providerId='openai-codex' if configured else None,
                identity=account, evidence='configured' if configured else 'unavailable',
                observedAt=int(time.time() * 1000), error=error)


def read_json(path):
    with path.open('rb') as stream:
        raw = stream.read(MAX_FILE + 1)
    if len(raw) > MAX_FILE:
        raise ValueError('size')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('shape')
    return value


def hermes(path, location):
    try:
        data = read_json(path)
        pool = data.get('credential_pool', {}).get('openai-codex', [])
        provider = data.get('providers', {}).get('openai-codex')
        if not isinstance(pool, list) or len(pool) > 128:
            return observation(location, error='unsupportedStore')
        # Provider singleton and pool are both eligible sources, not a priority vote.
        rows = list(pool)  # malformed/unknown candidates must not disappear
        if isinstance(provider, dict) and provider:
            rows.append(provider)
        if not rows:
            return observation(location, error='notConfigured')
        accounts = [identity(row) for row in rows]
        known = {x['key'] for x in accounts if x and x['key']}
        unknown = any(not x or not x['key'] for x in accounts)
        if len(known) > 1 or (len(accounts) > 1 and unknown):
            return observation(location, True, error='multipleConfiguredAccounts')
        account = next((x for x in accounts if x), None)
        return observation(location, True, account, 'runtimeUnverified' if account else 'identityUnavailable')
    except FileNotFoundError:
        return observation(location, error='notConfigured')
    except Exception:
        return observation(location, error='sourceUnavailable')


def runtime_store_uncertain(proc=Path('/proc')):
    """Linux runtime/store must be established, never inferred from disk version.
    We intentionally do not execute OpenCode (startup may migrate native state).
    Any live OpenCode requires stronger version/store evidence than this adapter
    currently supports. No command line or environment values leave this function.
    """
    try:
        for child in proc.iterdir():
            if not child.name.isdigit():
                continue
            try:
                comm = (child / 'comm').read_text().strip().lower()
                if comm.startswith('opencode'):
                    return True
            except (OSError, UnicodeError):
                continue
        return False
    except OSError:
        return True


def windows_runtime_uncertain():
    """Inspect only the fixed OpenCode process name; never cmdline or env.
    A live process needs version/store proof we do not have, so fail closed.
    Missing OS inspection is also uncertainty, not proof of no runtime.
    """
    try:
        import ctypes
        from ctypes import wintypes
        class Entry(ctypes.Structure):
            _fields_ = [('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD),
                        ('th32ProcessID', wintypes.DWORD), ('th32DefaultHeapID', ctypes.c_size_t),
                        ('th32ModuleID', wintypes.DWORD), ('cntThreads', wintypes.DWORD),
                        ('th32ParentProcessID', wintypes.DWORD), ('pcPriClassBase', wintypes.LONG),
                        ('dwFlags', wintypes.DWORD), ('szExeFile', wintypes.WCHAR * 260)]
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
        kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
        kernel.Process32FirstW.restype = wintypes.BOOL
        kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
        kernel.Process32NextW.restype = wintypes.BOOL
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
        if snapshot in (None, ctypes.c_void_p(-1).value):
            return True
        try:
            entry = Entry()
            entry.dwSize = ctypes.sizeof(entry)
            if not kernel.Process32FirstW(snapshot, ctypes.byref(entry)):
                return True
            while True:
                if entry.szExeFile.lower() in ('opencode', 'opencode.exe'):
                    return True
                if not kernel.Process32NextW(snapshot, ctypes.byref(entry)):
                    return ctypes.get_last_error() != 18  # ERROR_NO_MORE_FILES
        finally:
            kernel.CloseHandle(snapshot)
    except Exception:
        return True


def opencode(root, location, runtime_ambiguous=False, override=False):
    if override:
        return observation(location, error='sourceUnavailable')
    if runtime_ambiguous:
        return observation(location, error='runtimeStoreAmbiguous')
    db = root / 'opencode.db'
    try:
        if db.exists():
            # Existing V2 schema wins over stale V1 auth.json. No fallback on error.
            con = sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True, timeout=1)
            try:
                con.execute('PRAGMA query_only=ON')
                con.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 1000)
                deadline = time.monotonic() + 2
                rows = con.execute("SELECT id,label,active,json_extract(value,'$.type') AS auth_type,json_extract(value,'$.methodID') AS method_id,json_extract(value,'$.metadata.accountID') AS account_id FROM credential WHERE integration_id='openai' ORDER BY active DESC,time_created DESC,id DESC LIMIT 129").fetchall()
                active = [row for row in rows if row[2] == 1]
                if not rows:
                    return observation(location, error='notConfigured')
                if len(active) != 1:
                    return observation(location, True, error='multipleConfiguredAccounts')
                value = con.execute("SELECT value FROM credential WHERE integration_id='openai' AND id=? AND active=1 LIMIT 1", (active[0][0],)).fetchone()
                if not value or not isinstance(value[0], str) or len(value[0]) > MAX_FILE:
                    return observation(location, error='sourceUnavailable')
                row = json.loads(value[0])
            finally:
                con.close()
        else:
            row = read_json(root / 'auth.json').get('openai')
        if not isinstance(row, dict):
            return observation(location, error='notConfigured')
        if row.get('type') != 'oauth':
            return observation(location, error='notConfigured')
        account = identity(row)
        return observation(location, True, account, 'runtimeUnverified' if account else 'identityUnavailable')
    except FileNotFoundError:
        return observation(location, error='notConfigured')
    except sqlite3.DatabaseError:
        return observation(location, error='unsupportedStore')
    except Exception:
        return observation(location, error='sourceUnavailable')


def collect(remote=False):
    # No CLI path arguments, scanning credential stores, or app imports.
    suffix = 'vps' if remote else 'mother'
    home = Path.home()
    if remote:
        hermes_dir = os.environ.get('HERMES_DIR')
    else:
        local = os.environ.get('LOCALAPPDATA')
        hermes_dir = str(Path(local) / 'hermes') if local else None
    first = hermes(Path(hermes_dir) / 'auth.json', 'hermes-' + suffix) if hermes_dir else observation('hermes-' + suffix, error='sourceUnavailable')
    second = opencode(home / '.local/share/opencode', 'opencode-' + suffix,
                      runtime_ambiguous=runtime_store_uncertain() if remote else windows_runtime_uncertain(),
                      override='OPENCODE_AUTH_CONTENT' in os.environ or 'OPENCODE_TEST_HOME' in os.environ)
    return [first, second]


if __name__ == '__main__':
    if sys.argv[1:] not in ([], ['--remote']):
        sys.exit(2)
    try:
        print(json.dumps(collect(sys.argv[1:] == ['--remote']), separators=(',', ':'), ensure_ascii=True))
    except Exception:
        # Never print exception text: it may contain native data.
        sys.exit(1)
