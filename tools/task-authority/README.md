# TABS VPS task authority

Burak requested the main task record on VPS on 2026-09-27. Activation is verified
separately from source tests; consult the resolved `ATLAS_TASKS/AGENTS.md` and
`tasks_client.py status` for current migration state.

## Storage and access

- Authority: `ATLAS_TASKS/.state/tasks.sqlite3`, opened only by Python on VPS.
- Runtime: `ATLAS_TOOLS/atlas-tasks/tasks.py`; JSON RPC through existing
  `admin@atlas-vps` SSH and atlas-map. No public listener or background worker.
- Scope: complete `clients`, `projects`, `tasks`, `taskComments` records from
  TABS. These clients belong to Tasks, not the separate CRM module.
- TABS: existing Dexie tables act as an offline cache after migration. The
  `atlasTaskAuthorityV1` settings row holds the authority identity, baseline,
  durable request, deletion intents and unresolved conflicts.
- Hermes: `tasks_client.py`, with the local/VPS `atlas-tasks` skill. Read status
  before mutation. Only saved `sync` requests can be applied by this client.
- Markdown files remain projections, not input or an independent authority.

## Initial migration and normal operation

The TABS VPS panel backs up a transactionally captured task inventory to
AppLocalData/task-migration-backups, checks that no local row changed during
preparation, persists the bootstrap request, and imports only into an empty
authority. VPS keeps `.state/initial-import.json` and a revision/history log.
The complete acknowledged rows are checked against the saved request before
the app marks the cache active. The original local records remain available.

Local changes are sent after a short debounce; incoming changes are checked
every 15 seconds while TABS runs. Focused input editors pause cache application.
Loss of connectivity retains the exact pending operation. Restart retries its
same ID; SQLite commits records, history and receipts atomically.

SSH compression reduces attachment transfer time. Applied receipts refer to
the identical snapshot revision when possible, so attachments travel once.
Clients validate the referenced table, ID and revision before comparing the
acknowledged value to the saved request. Retried receipts whose records have
since changed retain their original values. The 64 MiB wire limit remains.

Per-record compare-and-set revisions prevent last-writer-wins data loss.
Conflicts retain local and remote values for a visible choice. Relationships
that cannot safely be merged use an atomic group choice. Missing cache rows
alone never request deletion. Actual hard deletions write explicit intent in
the same local transaction. Tombstones remain on VPS.

Incoming task changes also retain exact before/after values in a local durable
projection queue. The existing collision-protected writer refreshes generated
Markdown copies, separately from the authoritative task acknowledgement. Failed
copies stay queued and visible in the VPS panel; manually changed files are
preserved. Unresolvable retired project folders are retained, not bulk deleted.

No task change dispatches a Hermes worker. Permissions to execute plans stay
separate. There is no automatic upload of task data to GitHub or Drive.

## Recovery

Before maintenance, create a consistent SQLite checkpoint on VPS:

```sh
atlas_paths="$(sh /home/admin/.hermes/skills/atlas/atlas-map/scripts/resolve.sh)" && eval "$atlas_paths"
python3 "$ATLAS_TOOLS/atlas-tasks/tasks.py" --root "$ATLAS_TASKS" checkpoint --destination "$RECOVERY_ROOT/CHOSEN_NEW_TASK_BACKUP.sqlite3"
```

Choose a new private destination; the command never overwrites an existing
file. It uses SQLite backup and verifies integrity. The initial import files
are migration recovery copies, not ongoing independent disaster backups.
Brain's daily Drive job does not cover TASKS. This workflow adds no scheduler.

Restore checkpoints into a separate private fixture first and compare record
counts, IDs, values, revisions and operation receipts. Do not swap a live
authority with an older database while caches contain newer work: TABS stops
on changed identity or a generation rollback. Preserve the VPS database and
each local cache; reconcile outstanding requests before activating a restore.
Reverting only the application executable does not revert already acknowledged
VPS edits. Keep the VPS authority and use the SSH client during app recovery.

## Validation

`python -B -m unittest -v test_tasks.py` in this folder; frontend integration
tests use fake IndexedDB with this real SQLite process. `npm run check` and
Rust formatting/compile checks cover the application changes.

The `tasks-acceptance` feature requires the dedicated config
`src-tauri/tauri.tasks-acceptance.conf.json`, identity `com.tabs.tasks.acceptance`,
separate WebView/data/database, and `TABS_TASKS_FIXTURE` starting with
`task-authority-acceptance-`. Its fixed SSH route uses that named fixture below
HERMES_WORKSPACE. Production cannot select fixture paths. The acceptance app
has only task RPC, task backup and its own result command; it imports no
production stores, updater, credentials or Codex session service.
