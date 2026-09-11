# Clients → Projects → Tasks

Replace task subtasks with a Client layer. The Tasks module tree becomes **Client → Project → Task**, with a T3-style nested sidebar (client groups, nested project rows). Tasks appear only in the center panel, not as a third indent in the tree.

## Background

Today the Tasks module is:

```
Project → Task → Subtask (Task.parentId)
```

Projects (Brandpreneur, Wagner Atelier, WA Uniforms, …) are being used as **clients**. Subtasks add a third work level that the user does not want. CRM is compiled in but hidden (`CRM_MODULE_ENABLED = false`); Client must not depend on CRM.

Approved product mapping:

- Existing **Projects become Clients** (same names).
- Each new client gets a **General** project; existing tasks land there.
- **Client** is a Tasks-module entity, not a CRM Company.
- Left list matches the T3 Projects sidebar: collapsible parent rows, nested working items, `+` to add.
- Clicking a **project** selects it; the center List / Calendar / detail shows that project’s tasks.

## Key Decisions

1. **Client lives in the Tasks module, not CRM.** Fast, no CRM nav, can link later if CRM is turned on.
2. **Existing projects migrate to clients; each gets a General project.** Preserves names the user already uses as client labels. Tasks stay tasks (they are not promoted to projects).
3. **Subtasks flatten to sibling tasks.** `parentId` is removed. Titles and other fields are kept. No nested task UI or AI “create subtasks” actions.
4. **Two-level sidebar, tasks in the center.** Same logic as T3’s project list (repo → worktree). A third tree indent would fight the screenshot the user chose.
5. **Every project has a `clientId`; every task has a `projectId` after migration.** Unassigned tasks go under a seed **General** client → **General** project.
6. **Disk mirror is `TASKS/<client>/<project>/<taskId>/`.** Avoids colliding `General` folders across clients.
7. **Documents workspaces stay unrelated.** A Documents tab named Brandpreneur is not the Brandpreneur client.

## Data model

### Client (new)

```ts
interface Client {
  id: string;          // nanoid(8)
  name: string;        // trimmed, unique case-insensitive among clients
  color: string;       // same token set as projects today
  createdAt: number;
  order: number;
}
```

Name max length: 80 (same as projects).

### Project (changed)

```ts
interface Project {
  id: string;
  name: string;        // unique case-insensitive *within the same client*
  color: string;
  clientId: string;    // required
  createdAt: number;
  order: number;
}
```

Two clients may each have a project named `General`.

### Task (changed)

- `projectId: string` — required after migration (no longer `string | null`).
- Remove `parentId`.
- Other fields unchanged (`title`, `content`, `status`, `importance`, `date`, `assignees`, `order`, `deletedAt`, comments, AI batches, chat threads by `taskId`).

### Invariants

- Delete **client** → confirm, then soft-delete all of its tasks (`deletedAt`), delete its projects, delete the client. Trash already exists for tasks; do not add a separate client trash.
- Delete **project** → tasks of that project are not left dangling. Options at confirm time: move to that client’s General project, or soft-delete the tasks. Default: **move to General** (create General if missing).
- Delete **General** project: allowed only if it is empty, or after moving/deleting its tasks. Do not auto-recreate until the next “needs a catch-all” action (new unassigned import). If the user deletes General and later needs a catch-all, create it then.
- Cannot create a project without a `clientId`.
- Cannot create a task without a `projectId`. Quick-create uses the **selected project**, or the client’s General if only a client is selected.

## Dexie

Current schema is `TabsDB` v12 (`ZenEditorDB`). Add **v13**:

```
clients: 'id, name, order'
projects: 'id, name, clientId'
tasks: 'id, title, updatedAt, order, projectId, status'  // drop parentId index
```

Upgrade must be additive for clients and must rewrite projects/tasks in the same version so Dexie does not drop omitted stores incorrectly. Follow the existing pattern: declare all v13 stores explicitly (including workspaces, chat, agents, etc.), do not omit tables.

CRM/Forms stay in `ZenEditorCRMFormsDB`. No CRM schema change.

## Migration (v13 upgrade)

Run once on load, inside the Dexie `upgrade` (and a defensive repair on `loadClients` / `loadProjects` if v13 rows look half-applied — only if `clients` is empty and `projects` still lack `clientId`).

For each existing **project** row:

1. Insert a **client** with the same `id` is **not** required; use a new client id. Keep the project id stable so task `projectId` values that we rewrite stay coherent. Simpler algorithm:

   - `oldProjects = projects.toArray()`
   - For each old project `P`:
     - Create client `C` `{ id: nanoid(8), name: P.name, color: P.color, createdAt: P.createdAt, order: P.order ?? index }`
     - Create new project `G` `{ id: nanoid(8), name: 'General', color: P.color, clientId: C.id, createdAt: now, order: 0 }`
     - Point every task with `projectId === P.id` at `G.id`
     - Delete old project `P`
   - If any task still has `projectId == null` or pointing at a missing project:
     - Ensure client named `General` (create if missing)
     - Ensure that client has a `General` project
     - Assign those tasks there
   - For every task with `parentId`:
     - Keep the row as a normal task (same `projectId` as after rewrite)
     - Clear `parentId` (field omitted going forward)

2. **Name collisions:** two old projects with the same name (e.g. `Wagner Atelier` and `WAGNER ATELIER`) become two clients; uniqueness is case-insensitive. If names collide under `toLowerCase('tr-TR')`, append a numeric suffix to the second client (`Wagner Atelier 2`). Do not merge automatically.

3. **Empty DB:** if there are no projects and no tasks, seed one **General** client with one **General** project (replaces today’s “seed General project”).

Do not rewrite Documents workspaces, chat threads, or CRM.

## UI

### Tasks context panel (replaces the current task list’s project filter as the primary navigator)

Header: the left nav module stays **Tasks**. The tree header label is **Clients**. Actions:

- Add client (`+`) — same popover pattern as `AddNewProjectButton`
- Existing filter/search can remain if already on the list panel

Tree:

```
Brandpreneur          ← client (folder row, expand/collapse)
  General             ← project (nested row)
  Yeni web sitesi     ← later user-created project
Wagner Atelier
  General
```

- Indent and chevron like T3’s Projects list, using existing tree styles from `TreeNode` / task list CSS where possible — do not import T3 code.
- Client row: name, color dot, expand chevron. Click chevron toggles. Click name selects the **client** (see selection below).
- Project row: name, color dot. Click selects the **project**.
- `+` on a hovered/selected client row (or context menu) adds a **project** under that client. Duplicate names within the client toast the existing `tasks.projectExists` pattern.
- Keyboard: up/down among visible rows; left/right collapse/expand; Enter selects.

Selection state (uiStore or taskStore — prefer taskStore):

- `selectedClientId: string | null`
- `selectedProjectId: string | null`
- Selecting a project sets both (`clientId` derived from the project).
- Selecting a client sets `selectedClientId` and clears `selectedProjectId` (or sets it to General if we want a default — **clear project, show all tasks for that client**).

### Center panel

Unchanged shells:

- **List / Calendar / detail:** filter tasks:
  - project selected → that project only
  - client selected, no project → all tasks of that client’s projects
  - nothing selected → all tasks (or last selected; persist both ids in Dexie `settings`)
- **Projects kanban:** columns = projects of `selectedClientId`. If no client selected, prompt to pick a client (empty state) rather than flattening every client into one board.
- Task detail **SubtasksToggleBar** stays as the **task title / complete** chrome and loses any subtask affordance. Rename the component to `TaskTitleBar` in PR 3.
- Remove: `SubtaskQuickCreateInput`, subtask mode in `TaskCommentInput`, subtask list in `TaskDetailPanel`, “Create Subtasks” / “split into subtasks” action prompts.

### Header tabs

Keep List / Calendar / Projects. No new module. Left nav Tasks still enters this tree.

### Quick create

`QuickCreateInput` creates a task on `selectedProjectId`, else the selected client’s General project (create General if needed), else disabled with a short hint: pick a project.

## Disk mirror

`taskStore` currently writes `TASKS/${projectName}/${task.id}/task.md` under `AppLocalData`.

New path:

```
TASKS/<clientName>/<projectName>/<taskId>/task.md
TASKS/<clientName>/<projectName>/INDEX.md
```

Sanitize both names with the existing filesystem character filter. On v13 load, **do not** bulk-move old folders in the upgrade (upgrade has no FS). After load, a best-effort `migrateTaskFiles()` in `taskStore.loadTasks` (Tauri only):

- Write files to the new path for each living task
- Leave old `TASKS/<oldProjectName>/` in place if different; do not recursive-delete user folders automatically in v1 of this change (old names are now clients; old `TASKS/Brandpreneur/` may still exist from before). Optional cleanup can be a follow-up.

INDEX.md lists tasks for that project only.

## AI / tools

- `buildTaskAIContext`: drop subtask list; include `clientName` + `projectName`.
- `taskAIPlanner` / `create_task`: remove `parentId`; require `projectId` or resolve from selected project; optional `clientId` only as a resolver to General, not stored on the task.
- Builtin actions: remove Create Subtasks; change split-work prompt to “create tasks on this project”.
- Chat threads remain keyed by `taskId` (and writer `workspaceId`). No client-scoped thread required.

## i18n

Add `en` + `tr` strings for: Clients, Add client, Add project, client exists, pick a project, move tasks to General on project delete, flatten notice is not shown to users (silent migration).

## Testing

- Pure helpers: client/project name uniqueness (per client), migration function (old projects → clients + General + task rewrite + parentId strip + null projectId), kanban column source (projects for one client).
- Component: add-client popover, add-project under client, tree expand/select.
- Store: create client, create project with clientId, reject project without client, delete project moves tasks to General.
- Do not require a Dexie IndexedDB browser test for the upgrade if the migrator is a pure function `migrateProjectsToClients(oldProjects, oldTasks) → { clients, projects, tasks }` called from the Dexie upgrade.

## Out of scope

- Turning CRM on or linking Client → CRM Company
- Promoting existing tasks into projects
- Documents workspace ↔ client binding
- Multi-client views on one kanban
- Nested projects (only one project level)

## PR Plan

### PR 1 — Data layer and migration

- **Files:** `src/types/index.ts`, `src/services/db.ts`, `src/stores/clientStore.ts` (new), `src/stores/projectStore.ts`, `src/stores/taskStore.ts`, `src/stores/migrateProjectsToClients.ts` (pure migrator + tests)
- **Deps:** none
- **Does:** types, Dexie v13, migrator, stores (CRUD, no parentId / createSubtask), disk path helper. App still compiles; UI may temporarily treat all projects as a flat list keyed by clientId.

### PR 2 — Tasks sidebar tree

- **Files:** `src/components/taskManager/TaskListPanel.tsx` (or new `ClientProjectTree.tsx`), `AddNewProjectButton.tsx` / add-client control, `createProjectName.ts` (scope uniqueness per client), CSS, i18n
- **Deps:** PR 1
- **Does:** T3-style tree, selection, add client/project, filter list/calendar by selection.

### PR 3 — Remove subtasks from UI and AI

- **Files:** `TaskDetailPanel.tsx`, `SubtaskQuickCreateInput.tsx`, `TaskCommentInput.tsx`, `TaskCalendarView.tsx`, `TaskProjectsKanban.tsx`, `TaskProjectView.tsx`, `SubtasksToggleBar.tsx`, `taskAIContext.ts`, `taskAIPlanner.ts`, `taskAIStore.ts`, `ActionsPanel.tsx`, `ChatInput.tsx`, `TaskDraftPreview.tsx`, placeholders, tests
- **Deps:** PR 1 (can land parallel to PR 2 after PR 1)
- **Does:** flatten remaining UI; kanban columns per selected client; quick-create uses selected project.

### PR 4 — Disk mirror path + polish

- **Files:** `taskStore.ts` sync helpers, optional one-time copy to `TASKS/<client>/<project>/`
- **Deps:** PR 1
- **Does:** new paths, INDEX.md per project, no aggressive deletes of old folders.

## Open questions

None remaining from the design conversation. If implementation hits a product fork (e.g. deleting a client with many tasks), use the defaults in Invariants.
