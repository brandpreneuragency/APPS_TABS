# Clients → Projects → Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace task subtasks with a Tasks-module Client layer so the tree is Client → Project → Task, with a T3-style nested sidebar and tasks only in the center panel.

**Architecture:** Pure migrator + name helpers first (unit-tested, no Dexie). Dexie v13 and Zustand stores consume those helpers. The Tasks context panel becomes a two-level client/project tree; List/Calendar/Kanban filter by `selectedClientId` / `selectedProjectId`. Subtask UI and `Task.parentId` are removed. Disk mirror paths become `TASKS/<client>/<project>/<taskId>/` without deleting old folders.

**Tech Stack:** React 18, TypeScript, Zustand, Dexie 4 (`ZenEditorDB` v12 → v13), Vitest + Testing Library, i18next (en + tr), Tauri 2 `fs-adapter` for task markdown.

**Spec:** `docs/superpowers/specs/2026-09-11-clients-projects-tasks-design.md`

## Global Constraints

- Client is a Tasks-module entity, not CRM. Do not import CRM types or enable `CRM_MODULE_ENABLED`.
- Documents workspaces stay unrelated to clients.
- Name uniqueness uses `toLocaleLowerCase('tr-TR')`. Client names unique globally; project names unique **within a client**. Max name length 80.
- After migration every project has `clientId` and every living task has a non-null `projectId`.
- Delete client: confirm → soft-delete its tasks (`deletedAt`) → delete its projects → delete the client. No client trash.
- Delete project: default move tasks to that client’s `General` project (create General if missing).
- Do not import T3/Cursor UI. Reuse TABS tree/list CSS tokens.
- User-facing copy: update both `src/i18n/en.ts` and `src/i18n/tr.ts`.
- Tests: `npm test` (vitest run). Typecheck: `npm run typecheck`.
- Commits: one per task, English, conventional (`feat:` / `test:` / `fix:`).

## File map

| File | Role |
|---|---|
| `src/stores/migrateProjectsToClients.ts` | Pure v13 migrator |
| `src/stores/migrateProjectsToClients.test.ts` | Migrator tests |
| `src/stores/taskTreeNames.ts` | Unique client/project names, disk sanitize |
| `src/stores/taskTreeNames.test.ts` | Name + path tests |
| `src/stores/taskSelection.ts` | Filter tasks / kanban columns for selection |
| `src/stores/taskSelection.test.ts` | Selection filter tests |
| `src/types/index.ts` | `Client`, `Project.clientId`, `Task.projectId: string`, drop `parentId` |
| `src/services/db.ts` | Dexie v13 `clients` + rewrite projects/tasks |
| `src/stores/clientStore.ts` | Client CRUD |
| `src/stores/projectStore.ts` | Require `clientId`; delete moves tasks to General |
| `src/stores/taskStore.ts` | Drop subtask APIs; selection ids; new disk paths |
| `src/App.tsx` | `loadClients()` on startup |
| `src/i18n/en.ts`, `src/i18n/tr.ts` | Client/project strings |
| `src/components/taskManager/ClientProjectTree.tsx` | T3-style tree |
| `src/components/taskManager/ClientProjectTree.test.tsx` | Tree + add client/project |
| `src/components/taskManager/AddNewClientButton.tsx` | Header `+` for clients |
| `src/components/taskManager/createProjectName.ts` | Keep; used with per-client name lists |
| `src/components/taskManager/TaskListPanel.tsx` | Tree + filtered list |
| `src/components/taskManager/taskList.css` | Tree indent/chevron |
| `src/components/taskManager/QuickCreateInput.tsx` | Resolve project from selection |
| `src/components/taskManager/TaskProjectsKanban.tsx` | Columns = selected client’s projects |
| `src/components/taskManager/TaskCalendarView.tsx` | Stop skipping `parentId` |
| `src/components/taskManager/TaskProjectView.tsx` | Stop skipping `parentId` |
| `src/components/taskManager/TaskDetailPanel.tsx` | Remove subtask list |
| `src/components/taskManager/TaskCommentInput.tsx` | Remove subtask mode |
| `src/components/header/SubtasksToggleBar.tsx` | Rename to `TaskTitleBar.tsx` |
| `src/components/taskManager/SubtaskQuickCreateInput.tsx` | Delete |
| `src/services/taskAIContext.ts` | Client/project lines; drop SUBTASKS |
| `src/services/taskAIPlanner.ts` | Drop `parentId` |
| `src/stores/taskAIStore.ts` | Drop `parentId` on create |
| `src/components/sidebar/ActionsPanel.tsx`, `ChatInput.tsx` | Remove Create Subtasks actions |
| `src/components/sidebar/TaskDraftPreview.tsx` | Drop subtask wording |
| `src/utils/placeholders.ts` | Drop addSubtask placeholders |
| `src/hooks/useStreamingChat.ts` | Stop passing subtasks |

---

### Task 1: Pure migrator

**Files:**
- Create: `src/stores/migrateProjectsToClients.ts`
- Test: `src/stores/migrateProjectsToClients.test.ts`

**Interfaces:**
- Consumes: none
- Produces:

```ts
export type LegacyProject = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  order?: number;
  clientId?: string;
};

export type LegacyTask = {
  id: string;
  projectId: string | null;
  parentId?: string;
  deletedAt?: number;
  [key: string]: unknown;
};

export type MigratedClient = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  order: number;
};

export type MigratedProject = {
  id: string;
  name: string;
  color: string;
  clientId: string;
  createdAt: number;
  order: number;
};

export function migrateProjectsToClients(
  oldProjects: readonly LegacyProject[],
  oldTasks: readonly LegacyTask[],
  opts: { id: () => string; now: number },
): { clients: MigratedClient[]; projects: MigratedProject[]; tasks: LegacyTask[] };
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { migrateProjectsToClients } from './migrateProjectsToClients';

function ids(seq: string[]) {
  let i = 0;
  return () => seq[i++] ?? `id-${i}`;
}

describe('migrateProjectsToClients', () => {
  it('turns each old project into a client with a General project and rewrites tasks', () => {
    const out = migrateProjectsToClients(
      [{ id: 'p-brp', name: 'Brandpreneur', color: 'text-amber-500', createdAt: 1, order: 0 }],
      [{ id: 't1', projectId: 'p-brp', title: 'Yeni web sitesi' }],
      { id: ids(['c1', 'g1']), now: 100 },
    );
    expect(out.clients).toEqual([
      { id: 'c1', name: 'Brandpreneur', color: 'text-amber-500', createdAt: 1, order: 0 },
    ]);
    expect(out.projects).toEqual([
      { id: 'g1', name: 'General', color: 'text-amber-500', clientId: 'c1', createdAt: 100, order: 0 },
    ]);
    expect(out.tasks[0].projectId).toBe('g1');
    expect(out.tasks[0]).not.toHaveProperty('parentId');
  });

  it('flattens subtasks onto the same project', () => {
    const out = migrateProjectsToClients(
      [{ id: 'p1', name: 'WA', color: 'c', createdAt: 1 }],
      [
        { id: 'parent', projectId: 'p1' },
        { id: 'child', projectId: 'p1', parentId: 'parent' },
      ],
      { id: ids(['c1', 'g1']), now: 1 },
    );
    expect(out.tasks.every((t) => t.projectId === 'g1')).toBe(true);
    expect(out.tasks.every((t) => t.parentId === undefined)).toBe(true);
  });

  it('suffixes colliding client names case-insensitively (tr-TR)', () => {
    const out = migrateProjectsToClients(
      [
        { id: 'a', name: 'Wagner Atelier', color: 'c', createdAt: 1 },
        { id: 'b', name: 'WAGNER ATELIER', color: 'c', createdAt: 2 },
      ],
      [],
      { id: ids(['c1', 'g1', 'c2', 'g2']), now: 1 },
    );
    expect(out.clients.map((c) => c.name)).toEqual(['Wagner Atelier', 'WAGNER ATELIER 2']);
  });

  it('sends null/orphan projectId tasks to a General client/project', () => {
    const out = migrateProjectsToClients(
      [],
      [{ id: 'orphan', projectId: null }],
      { id: ids(['c-gen', 'p-gen']), now: 1 },
    );
    expect(out.clients[0].name).toBe('General');
    expect(out.projects[0]).toMatchObject({ name: 'General', clientId: out.clients[0].id });
    expect(out.tasks[0].projectId).toBe(out.projects[0].id);
  });

  it('seeds General client+project when empty', () => {
    const out = migrateProjectsToClients([], [], { id: ids(['c', 'p']), now: 1 });
    expect(out.clients).toHaveLength(1);
    expect(out.projects).toHaveLength(1);
    expect(out.clients[0].name).toBe('General');
    expect(out.projects[0].name).toBe('General');
  });

  it('is a no-op when projects already have clientId and clients exist', () => {
    const projects = [
      { id: 'g', name: 'General', color: 'c', createdAt: 1, clientId: 'c1' },
    ];
    const out = migrateProjectsToClients(
      projects,
      [{ id: 't', projectId: 'g' }],
      { id: ids(['x']), now: 1 },
    );
    expect(out.clients).toEqual([]);
    expect(out.projects).toEqual(projects);
    expect(out.tasks[0].projectId).toBe('g');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/migrateProjectsToClients.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

Implement `migrateProjectsToClients` in `src/stores/migrateProjectsToClients.ts`:

- If every old project already has a non-empty `clientId`, return `{ clients: [], projects: [...oldProjects] as MigratedProject[], tasks: stripParentId(oldTasks) }` (caller treats empty `clients` as “already migrated” **only when** `oldProjects[0].clientId` is set; the empty-DB seed path is `oldProjects.length === 0`).
- Empty `oldProjects` **and** empty `oldTasks`: seed General client + General project, return tasks `[]`.
- Empty `oldProjects` **but** tasks exist: treat as orphan path (General client/project, assign all tasks).
- Otherwise: for each project in input order, allocate client id + General project id; unique client name via a `Set` of `name.toLocaleLowerCase('tr-TR')`; on collision append ` ${n}` starting at 2 (`WAGNER ATELIER 2`).
- Rewrite `task.projectId` from old project id → new General project id.
- Orphans (`projectId == null` or not in the rewrite map): ensure a client named `General` (reuse if a migrated client already has that exact unique name `general`); ensure it has a General project; assign.
- Strip `parentId` from every returned task (`const { parentId, ...rest } = t`).
- Preserve other task fields with spread.

Do **not** call Dexie or nanoid inside this file; only `opts.id` / `opts.now`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx vitest run src/stores/migrateProjectsToClients.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/migrateProjectsToClients.ts src/stores/migrateProjectsToClients.test.ts
git commit -m "feat: add pure projects-to-clients migrator"
```

---

### Task 2: Name uniqueness and disk path helpers

**Files:**
- Create: `src/stores/taskTreeNames.ts`
- Test: `src/stores/taskTreeNames.test.ts`

**Interfaces:**
- Consumes: none
- Produces:

```ts
export const NAME_MAX = 80;
export function normalizeTreeName(raw: string): string; // trim, slice 0..80
export function nameKey(name: string): string; // toLocaleLowerCase('tr-TR')
export function isNameTaken(name: string, existing: readonly string[]): boolean;
export function uniqueClientName(desired: string, existing: readonly string[]): string;
export function sanitizeFsName(name: string): string; // replace /[<>:"/\\|?*\x00-\x1F]/g with '_'
export function taskMirrorDir(clientName: string, projectName: string, taskId: string): string;
export function projectMirrorDir(clientName: string, projectName: string): string;
```

`taskMirrorDir` returns `TASKS/${sanitizeFsName(client)}/${sanitizeFsName(project)}/${taskId}` (forward slashes).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  isNameTaken, uniqueClientName, sanitizeFsName, taskMirrorDir, projectMirrorDir, normalizeTreeName,
} from './taskTreeNames';

describe('taskTreeNames', () => {
  it('treats names as taken case-insensitively with tr-TR', () => {
    expect(isNameTaken('GENERAL', ['General'])).toBe(true);
    expect(isNameTaken('Launch', ['General'])).toBe(false);
  });

  it('suffixes until unique', () => {
    expect(uniqueClientName('WA', ['WA'])).toBe('WA 2');
    expect(uniqueClientName('WA', ['WA', 'WA 2'])).toBe('WA 3');
  });

  it('trims and caps at 80 chars', () => {
    expect(normalizeTreeName('  ab  ')).toBe('ab');
    expect(normalizeTreeName('x'.repeat(90)).length).toBe(80);
  });

  it('builds nested TASKS paths', () => {
    expect(sanitizeFsName('Hermes / AI')).toBe('Hermes _ AI');
    expect(projectMirrorDir('Brandpreneur', 'General')).toBe('TASKS/Brandpreneur/General');
    expect(taskMirrorDir('Brandpreneur', 'General', 'abc')).toBe('TASKS/Brandpreneur/General/abc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/taskTreeNames.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement `src/stores/taskTreeNames.ts`**

Use the same sanitize regex as `taskStore.ts` today: `/[<>:"/\\|?*\x00-\x1F]/g`.

Then change `migrateProjectsToClients` to call `uniqueClientName` instead of inlined suffix logic. Keep the migrator tests green.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/stores/taskTreeNames.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/taskTreeNames.ts src/stores/taskTreeNames.test.ts
git commit -m "feat: add client/project name and task disk path helpers"
```

---

### Task 3: Selection filter helpers

**Files:**
- Create: `src/stores/taskSelection.ts`
- Test: `src/stores/taskSelection.test.ts`

**Interfaces:**
- Consumes: `Project` shape `{ id: string; clientId: string; name: string; color?: string }`
- Produces:

```ts
export function filterTasksForSelection<T extends { projectId: string; deletedAt?: number }>(
  tasks: readonly T[],
  projects: readonly { id: string; clientId: string }[],
  selectedClientId: string | null,
  selectedProjectId: string | null,
): T[];
// living tasks only (!deletedAt)
// project selected → that projectId
// client selected, no project → projectId in that client's projects
// neither → all living tasks

export function projectsForClient<T extends { clientId: string }>(
  projects: readonly T[],
  clientId: string | null,
): T[];

export function kanbanColumnsForClient(
  projects: readonly { id: string; name: string; color: string; clientId: string }[],
  tasks: readonly { id: string; projectId: string; deletedAt?: number }[],
  selectedClientId: string | null,
): { id: string; name: string; color: string; taskIds: string[] }[];
// empty array if selectedClientId is null (caller shows empty state)
```

- [ ] **Step 1: Write failing tests** covering the three filter modes and “kanban empty without client”.
- [ ] **Step 2: Run `npx vitest run src/stores/taskSelection.test.ts`** — expect FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Tests PASS**
- [ ] **Step 5: Commit** `feat: add task selection filter helpers`

---

### Task 4: Types + Dexie v13

**Files:**
- Modify: `src/types/index.ts` (`Client`, `Project`, `Task`)
- Modify: `src/services/db.ts` (v13)
- Modify: any `Task` literals in tests that set `parentId` or `projectId: null` so `npm run typecheck` still works **or** leave compile errors for Task 5–6 if tests still use old shape — **this task must keep `npm run typecheck` passing**. Grep `parentId` and fix types in test fixtures to omit `parentId` and use `projectId: string`. Temporary: keep `parentId` optional on Task until Task 6 if needed to compile; spec wants it gone. Prefer removing it here and fixing fixtures in the same commit.

**Interfaces:**
- Consumes: `migrateProjectsToClients` from Task 1
- Produces: Dexie table `clients`; `projects` indexed `id, name, clientId`; `tasks` without `parentId` index

```ts
export interface Client {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  order: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  clientId: string;
  createdAt: number;
  order: number;
}

// Task.projectId: string  (required)
// Task: delete parentId
```

- [ ] **Step 1: Add v13 on `TabsDB` in `src/services/db.ts`**

Copy the **entire** v12 `.stores({...})` map, then:

- add `clients: 'id, name, order'`
- change `projects: 'id, name, clientId'`
- change `tasks: 'id, title, updatedAt, order, projectId, status'` (no `parentId`)

`.upgrade(async (tx) => { ... })`:

```ts
this.version(13).stores({ /* full map */ }).upgrade(async (tx) => {
  const oldProjects = await tx.table('projects').toArray();
  const oldTasks = await tx.table('tasks').toArray();
  let n = 0;
  const { clients, projects, tasks } = migrateProjectsToClients(oldProjects, oldTasks, {
    id: () => `m13${(n++).toString(36).padStart(6, '0')}`,
    now: Date.now(),
  });
  if (clients.length === 0 && oldProjects.some((p: { clientId?: string }) => p.clientId)) {
    // already migrated
    return;
  }
  await tx.table('projects').clear();
  await tx.table('tasks').clear();
  await tx.table('clients').bulkAdd(clients);
  await tx.table('projects').bulkAdd(projects);
  await tx.table('tasks').bulkAdd(tasks);
});
```

Use a deterministic `id` factory (not `nanoid`) inside upgrade so the function stays testable; uniqueness is enough.

Empty-DB seed: migrator already seeds General when both arrays are empty — `bulkAdd` that.

- [ ] **Step 2: Update `src/types/index.ts`** as specified.
- [ ] **Step 3: Grep `parentId` and `projectId: null` in `src/` tests; fix fixtures.**
- [ ] **Step 4: Run `npm run typecheck` and `npx vitest run src/stores/migrateProjectsToClients.test.ts`**

Expected: typecheck PASS (or only errors in stores you will fix in Task 5). If `projectStore`/`taskStore` fail typecheck because they still use old fields, **fix those call sites in Task 5–6 immediately after**; do not leave main untypecheckable across commits if avoidable. If typecheck fails only on store files, include a minimal stub in this commit: `createProject` still compiles by adding `clientId` param with a fallback — better to combine type fixes into Task 5. **This commit may include mechanical `parentId` deletions in UI that would not compile otherwise**, but do not redesign UI yet (filter `!t.parentId` → delete the filter so all tasks show).

- [ ] **Step 5: Commit** `feat: add Client type and Dexie v13 migration`

---

### Task 5: `clientStore` + `projectStore`

**Files:**
- Create: `src/stores/clientStore.ts`
- Modify: `src/stores/projectStore.ts`
- Modify: `src/App.tsx` (load clients)
- Test: `src/stores/projectStore.general.test.ts` for **pure** `ensureGeneralProject` if extracted; otherwise test `resolveCreateProjectName` lists per client.

Extract so stores stay thin:

```ts
// in projectStore.ts or taskTreeNames.ts
export function ensureGeneralProjectRecord(
  clientId: string,
  existing: readonly Project[],
  opts: { id: () => string; now: number; color: string },
): { project: Project; created: boolean };
```

Returns existing General (name key `general`) for that `clientId`, or a new record `{ name: 'General', order: 0, ... }`.

**clientStore produces:**

```ts
loadClients(): Promise<void>
createClient(name: string): Promise<Client | null>  // also creates General project via projectStore or db
updateClient(id, { name, color })
deleteClient(id): Promise<void>  // soft-delete tasks of its projects, delete projects, delete client
getClientById(id: string | null): Client | undefined
```

Colors: reuse `PROJECT_COLORS` from `projectStore` — **move the array** to `src/stores/taskTreeNames.ts` as `TREE_COLORS` and import from both stores so they do not drift.

**projectStore changes:**

```ts
createProject(name: string, clientId: string): Promise<Project | null>
// reject if !clientId or duplicate name within client
deleteProject(id: string): Promise<void>
// find clientId; ensureGeneralProject; update tasks with that projectId to General id (skip if deleting General itself — then soft-delete those tasks instead)
loadProjects: if clients table empty AND projects lack clientId, run migrateProjectsToClients repair then persist (spec defensive repair)
```

- [ ] **Step 1: Test `ensureGeneralProjectRecord`** (pure) in `src/stores/taskTreeNames.test.ts` or `projectStore.general.test.ts`
- [ ] **Step 2: FAIL then implement**
- [ ] **Step 3: Implement stores against Dexie `db.clients` / `db.projects` / `db.tasks`**

`deleteClient`:

1. `projects = get().projects.filter(p => p.clientId === id)`
2. For each project, `db.tasks.where('projectId').equals(project.id)` → set `deletedAt: Date.now()`
3. `db.projects.bulkDelete(project ids)`
4. `db.clients.delete(id)`
5. Update zustand tasks/projects/clients in memory (import `useTaskStore.getState()` carefully to avoid cycles: perform Dexie writes in `clientStore`, then `useTaskStore.getState().loadTasks()`)

To avoid circular imports: put cascade delete in `clientStore` using `db` directly, then call `useProjectStore.getState().loadProjects()` and `useTaskStore.getState().loadTasks()`. If circular, create `src/stores/taskCascade.ts` with `softDeleteTasksForProjectIds(ids: string[]): Promise<void>` using only `db`.

- [ ] **Step 4: `App.tsx` startup `Promise.all` includes `useClientStore.getState().loadClients()`** (or `loadProjects` triggers repair). Order: loadClients, loadProjects, loadTasks.
- [ ] **Step 5: `npm run typecheck` + `npx vitest run src/stores/taskTreeNames.test.ts src/stores/migrateProjectsToClients.test.ts`**
- [ ] **Step 6: Commit** `feat: add client store and project.clientId`

---

### Task 6: Flatten `taskStore` + persist selection

**Files:**
- Modify: `src/stores/taskStore.ts`
- Modify: `src/stores/uiStore.ts` only if selection was planned there — **spec prefers taskStore**

**Produces:**

```ts
selectedClientId: string | null
selectedProjectId: string | null
setSelection(clientId: string | null, projectId: string | null): void
// project selected → also set clientId from that project
// client selected → projectId null
// persist both to db.settings keys `selectedClientId` / `selectedProjectId`

createTask(title, opts): require opts.projectId; if missing return null + toast
updateTask: drop parentId from Pick<>
remove getSubtasks, reorderSubtasks, getLastSubtaskDate, createSubtask
getTasksByProject(projectId: string): Task[]  // no longer null
```

`loadTasks`: restore selection from settings if ids still exist; else `selectedClientId = first client`, `selectedProjectId = null`.

- [ ] **Step 1: Delete subtask methods and `parentId` writes. Fix every call site that would not compile** (`TaskDetailPanel`, `SubtaskQuickCreateInput` still imported — if still present, make them compile by removing getSubtasks usage **or** leave UI removal for Task 9 but then Task 6 cannot typecheck). **Do UI removal in Task 9; for this task, if UI still calls `createSubtask`, add a deprecated wrapper that creates a normal task on the same project without parentId** so typecheck passes, then Task 9 deletes it. Spec: remove APIs. Prefer deleting methods and fixing compile errors by stubbing UI to not call them (comment-free: delete the call, leave empty subtask section until Task 9). Smallest compile fix: `getSubtasks` returns `[]` and `createSubtask` calls `createTask` without parentId. Task 9 removes the wrappers and UI.

**Decision for executors:** keep `getSubtasks` returning `[]` and `createSubtask` delegating to `createTask` **one commit only if needed**; Task 9 must delete both.

- [ ] **Step 2: Implement selection + settings persist via existing `getSetting`/`setSetting` in `src/services/db.ts`**
- [ ] **Step 3: `npm run typecheck` PASS**
- [ ] **Step 4: Commit** `feat: persist client/project selection and drop subtask writes`

---

### Task 7: i18n

**Files:**
- Modify: `src/i18n/en.ts` `tasks` block
- Modify: `src/i18n/tr.ts` `tasks` block

Add keys (exact):

```ts
// en
clients: 'Clients',
addNewClient: 'Add client',
clientNamePlaceholder: 'Client name',
addClient: 'Add',
clientExists: 'A client named "{{name}}" already exists.',
clientCreated: 'Created client "{{name}}".',
addProjectToClient: 'Add project',
pickAProject: 'Pick a project to add a task.',
deleteClientConfirm: 'Delete client "{{name}}"? Its tasks will move to Trash.',
deleteProjectConfirm: 'Delete project "{{name}}"? Tasks will move to General.',
kanbanPickClient: 'Select a client to see its projects.',
generalProject: 'General',
```

```ts
// tr
clients: 'Müşteriler',
addNewClient: 'Müşteri ekle',
clientNamePlaceholder: 'Müşteri adı',
addClient: 'Ekle',
clientExists: '"{{name}}" adlı bir müşteri zaten var.',
clientCreated: '"{{name}}" müşterisi oluşturuldu.',
addProjectToClient: 'Proje ekle',
pickAProject: 'Görev eklemek için bir proje seçin.',
deleteClientConfirm: '"{{name}}" müşterisi silinsin mi? Görevleri Çöp Kutusu’na taşınır.',
deleteProjectConfirm: '"{{name}}" projesi silinsin mi? Görevler General’e taşınır.',
kanbanPickClient: 'Projelerini görmek için bir müşteri seçin.',
generalProject: 'General',
```

Keep existing `addNewProject` / `projectExists` / `projectCreated` for project popover.

- [ ] **Step 1: Add keys to both files**
- [ ] **Step 2: Commit** `feat: add client i18n strings`

---

### Task 8: Client/project tree sidebar

**Files:**
- Create: `src/components/taskManager/ClientProjectTree.tsx`
- Create: `src/components/taskManager/AddNewClientButton.tsx` (clone `AddNewProjectButton.tsx` but `createClient` + `tasks.addNewClient`)
- Modify: `src/components/taskManager/AddNewProjectButton.tsx` — require `clientId: string` prop; existing names = projects of that client
- Create: `src/components/taskManager/ClientProjectTree.test.tsx`
- Create: `src/components/taskManager/AddNewClientButton.test.tsx` (mirror `AddNewProjectButton.test.tsx`)
- Modify: `src/components/taskManager/taskList.css`

**Produces:** tree used by TaskListPanel.

Behavior:

- Header row: label `t('tasks.clients')` + `AddNewClientButton`
- Clients sorted by `order` then name
- Each client: chevron, color dot (`PROJECT_DOT_COLORS` from kanban or `var(--c-text-3)` fallback), name button
- Expanded clients show projects indented 16px
- Click client name: `setSelection(client.id, null)` and expand
- Click chevron: toggle expand only (`expandedClientIds: Set<string>` local state; default expand `selectedClientId`)
- Click project: `setSelection(project.clientId, project.id)`
- Hover client: small `+` calling add-project popover for that client (`AddNewProjectButton clientId={id}`)
- Selected row: `background: var(--c-background-4)`
- Keyboard on the tree container: ArrowUp/Down move among visible rows; ArrowLeft collapse / ArrowRight expand; Enter selects focused row

- [ ] **Step 1: Write `AddNewClientButton.test.tsx`** same as project button tests with `createClient` mock
- [ ] **Step 2: FAIL, implement button, PASS**
- [ ] **Step 3: Write tree test**

```tsx
it('selects a nested project', async () => {
  const setSelection = vi.fn();
  // mock stores: one client Brandpreneur with General project
  render(<ClientProjectTree />);
  await user.click(screen.getByRole('button', { name: 'General' }));
  expect(setSelection).toHaveBeenCalledWith('c1', 'p-gen');
});
```

- [ ] **Step 4: Implement tree + CSS** (`.client-tree`, `.client-tree-row`, `.client-tree-row--project`, `.client-tree-row--on`)
- [ ] **Step 5: Tests PASS**
- [ ] **Step 6: Commit** `feat: add T3-style client/project tree`

---

### Task 9: Wire tree into TaskListPanel; filter list/calendar

**Files:**
- Modify: `src/components/taskManager/TaskListPanel.tsx`
- Modify: `src/components/taskManager/TaskCalendarView.tsx`
- Modify: `src/components/taskManager/TaskProjectView.tsx`

- [ ] **Step 1: TaskListPanel**
  - Spec: tasks are not a third tree indent. Context panel is the navigator.
  - `TaskListPanel` (context panel) always renders `ClientProjectTree` + `QuickCreateInput` at the bottom.
  - If `activeTab === 'list'`: also render the existing date-grouped list **below** the tree (center is still `TaskDetailPanel`; keeping the compact list in the left panel is OK so users can click a task without leaving the tree). Filter that list with `filterTasksForSelection`.
  - If `activeTab === 'calendar'`: tree + `TaskCalendarView` (same as today, plus tree on top).
  - Remove `tasks.filter(t => !t.parentId)`.
  - Date groups use `filterTasksForSelection(tasks, projects, selectedClientId, selectedProjectId)`.

- [ ] **Step 2: Calendar/ProjectView** — remove `if (t.parentId) continue/return false`. Filter using `filterTasksForSelection` with store selection.
- [ ] **Step 3: QuickCreateInput** stays in the list panel footer; disable send when `resolveQuickCreateProjectId()` is null; title `t('tasks.pickAProject')`.

Add to `taskSelection.ts`:

```ts
export function resolveQuickCreateProjectId(
  selectedClientId: string | null,
  selectedProjectId: string | null,
  projects: readonly { id: string; clientId: string; name: string }[],
): string | null;
// selectedProjectId if set
// else General project of selectedClientId (name key general)
// else null
```

Unit test it in `taskSelection.test.ts` in this task if not already.

- [ ] **Step 4: `npm test` + `npm run typecheck`**
- [ ] **Step 5: Commit** `feat: navigate tasks by client/project tree`

---

### Task 10: Kanban per selected client + quick create

**Files:**
- Modify: `src/components/taskManager/TaskProjectsKanban.tsx`
- Modify: `src/components/taskManager/QuickCreateInput.tsx`

- [ ] **Step 1: Kanban**
  - `const selectedClientId = useTaskStore(s => s.selectedClientId)`
  - If `!selectedClientId`, render `CRMEmptyState` or existing empty component with `t('tasks.kanbanPickClient')`. No Uncategorized column.
  - Columns = `kanbanColumnsForClient(...)` mapped to existing `Column` type (task objects from ids).
  - `createProject(name, selectedClientId)`
  - `handleAddTask(projectId)` always passes `projectId` (column id).
  - `handleMove` only to real project ids (no null).
  - Remove `rootTasks.filter(!parentId)` — use living tasks.

- [ ] **Step 2: QuickCreateInput**
  - Remove “No project” dropdown item.
  - Project dropdown lists `projectsForClient(projects, selectedClientId)`.
  - `createTask(title, { projectId: resolved })` where resolved = picked project or `resolveQuickCreateProjectId`.
  - If resolved is null, toast `t('tasks.pickAProject')` and return.

- [ ] **Step 3: typecheck + tests**
- [ ] **Step 4: Commit** `feat: scope kanban and quick-create to selected client`

---

### Task 11: Remove subtask UI

**Files:**
- Modify: `src/components/taskManager/TaskDetailPanel.tsx` — delete subtask list, drag-reorder subtasks, `SubtaskDueDatePicker` import, `getSubtasks` / `reorderSubtasks`
- Modify: `src/components/taskManager/TaskCommentInput.tsx` — delete `mode: 'comment' | 'subtask'` and `createSubtask` path; comments only
- Delete: `src/components/taskManager/SubtaskQuickCreateInput.tsx`
- Rename: `src/components/header/SubtasksToggleBar.tsx` → `src/components/header/TaskTitleBar.tsx`; export `TaskTitleBar`; update `App.tsx` import. Keep same DOM class names if CSS depends on `subtasks-toggle-bar` **or** rename classes in `src/styles` / `taskDetail.css` in the same commit. Grep `SubtasksToggleBar` and `subtasks-toggle`.
- Modify: `src/utils/placeholders.ts` — remove `addSubtask` / `addSubtaskFooter`
- Modify: `src/App.tsx` — `subtasksBar={<TaskTitleBar />}`
- Delete wrappers `getSubtasks` / `createSubtask` from `taskStore` if still present.

- [ ] **Step 1: Grep `parentId|createSubtask|getSubtasks|SubtaskQuickCreate|builtin_task_subtasks` and delete**
- [ ] **Step 2: `npm run typecheck` and `npm test`**
- [ ] **Step 3: Commit** `feat: remove task subtasks from the UI`

---

### Task 12: AI context and planner

**Files:**
- Modify: `src/services/taskAIContext.ts`
- Modify: `src/hooks/useStreamingChat.ts` (stop `getSubtasks`)
- Modify: `src/services/taskAIPlanner.ts`
- Modify: `src/stores/taskAIStore.ts`
- Modify: `src/components/sidebar/ActionsPanel.tsx`
- Modify: `src/components/sidebar/ChatInput.tsx`
- Modify: `src/components/sidebar/TaskDraftPreview.tsx`

**`buildTaskAIContext` new signature:**

```ts
export function buildTaskAIContext(
  task: Task,
  comments: TaskComment[],
  meta?: { clientName?: string; projectName?: string },
): TaskAIContextPayload;
```

Drop `subtasks` from `TaskAIContextPayload` (breaking; fix all call sites). Lines include `client: ${meta?.clientName ?? '(none)'}` and `project: ${meta?.projectName ?? '(none)'}`. Remove `SUBTASKS` section.

Planner: remove `parentId` from parsed ops and from the tool JSON example. `create_task` must include `projectId`.

Actions: delete id `builtin_task_subtasks`. Change split-work prompt to: `Create tasks on this project with clear titles. Do not create subtasks.`

`TaskDraftPreview`: operation is always `task`, never `subtask for ...`.

- [ ] **Step 1: Add/adjust unit tests next to `taskAIContext` if a test file exists; else `src/services/taskAIContext.test.ts`** asserting no `SUBTASKS` and client/project lines present.
- [ ] **Step 2: Implement + fix call sites**
- [ ] **Step 3: `npx vitest run` + `npm run typecheck`**
- [ ] **Step 4: Commit** `feat: drop subtasks from task AI context`

---

### Task 13: Disk mirror paths

**Files:**
- Modify: `src/stores/taskStore.ts` (`syncTaskToFile`, `deleteTaskFile`, `regenerateProjectIndex`)

Use `taskMirrorDir` / `projectMirrorDir` from Task 2. Look up `db.projects.get` then `db.clients.get(project.clientId)` for names.

`regenerateProjectIndex(projectId)` writes `INDEX.md` under `projectMirrorDir`.

`loadTasks` after hydrate, if `isTauriRuntime()`, `void migrateTaskFiles(get().tasks)`:

```ts
async function migrateTaskFiles(tasks: Task[]): Promise<void> {
  for (const task of tasks) {
    if (task.deletedAt) continue;
    await syncTaskToFile(task);
  }
}
```

Do **not** `fsAdapter.remove` old `TASKS/<oldProjectName>` trees.

- [ ] **Step 1: Unit-test path helpers already exist; optionally test INDEX content builder as a pure function `formatProjectIndex(projectName, tasks: {id,title}[]): string` in `taskTreeNames.ts`**

```ts
export function formatProjectIndex(projectName: string, tasks: readonly { id: string; title: string }[]): string {
  const list = tasks.map((t) => `- [${t.id}] ${t.title}`).join('\n');
  return `# ${projectName} Tasks\n\n${list}`;
}
```

- [ ] **Step 2: Wire fs helpers**
- [ ] **Step 3: Commit** `feat: nest task markdown under client/project folders`

---

### Task 14: Full verification

- [ ] **Step 1: `npm run typecheck`**
- [ ] **Step 2: `npm test`**
- [ ] **Step 3: `npm run lint`**
- [ ] **Step 4: Grep leftover `parentId`, `createSubtask`, `SubtaskQuickCreate`, `builtin_task_subtasks` — expect no production hits**
- [ ] **Step 5: Manual (Tauri):** open Tasks; confirm clients in the tree, General under each, click project → center tasks; add client; add project; kanban empty until client selected; no subtask composer.
- [ ] **Step 6: Commit only if verification fixes were needed**

---

## Spec coverage

| Spec item | Task |
|---|---|
| Client type + uniqueness | 2, 4, 5 |
| Project.clientId, per-client names | 2, 4, 5 |
| Task.projectId required, no parentId | 4, 6, 11 |
| Dexie v13 + migrator | 1, 4 |
| Existing projects → clients + General | 1 |
| Flatten subtasks | 1, 11, 12 |
| Orphans → General client | 1 |
| Name collision suffix | 1, 2 |
| Empty DB seed | 1 |
| Delete client cascade | 5 |
| Delete project → General | 5 |
| T3-style tree | 8, 9 |
| Selection + persist | 6, 9 |
| List/calendar filter | 3, 9 |
| Kanban per client, no uncategorized | 3, 10 |
| Quick create | 3, 10 |
| Remove subtask UI/actions | 11, 12 |
| TaskTitleBar rename | 11 |
| i18n en+tr | 7 |
| Disk TASKS/client/project | 2, 13 |
| No CRM | global |
| Documents unrelated | global |

## Notes for executors

- `createProject` call sites today: `AddNewProjectButton`, `TaskProjectsKanban`, `TaskContextMenu`, `TaskMetadataControls`. After Task 5 they must pass `clientId` (`selectedClientId` or the task’s project’s client).
- `Task.projectId` was `string | null`. Metadata dropdowns with “no project” must go away (Task 10).
- Do not enable CRM.
