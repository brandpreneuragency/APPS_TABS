# Handoff: implement Clients → Projects → Tasks (SDD)

Paste everything below the line into a **new** Grok / agent chat in this repo.

---

You are the **controller** for Subagent-Driven Development. Implement the already-approved spec and plan. Do **not** redesign. Do **not** ask the human to re-confirm product decisions.

## Skills (required)

1. Read and follow `superpowers:subagent-driven-development` (or the bundled equivalent).
2. Before any code: `superpowers:using-git-worktrees` — create an isolated worktree/branch. **Do not implement on `main`.** The human did not consent to landing this on main.
3. After the branch is green: `superpowers:finishing-a-development-branch` (do **not** merge or push unless they ask).

Execute **all 14 plan tasks** without pausing between them. Fresh implementer subagent per task, then a task reviewer, then continue. Ledger progress so compaction cannot make you redo completed tasks.

## Authority

| Doc | Path |
|---|---|
| Spec (binding) | `docs/superpowers/specs/2026-09-11-clients-projects-tasks-design.md` |
| Plan (argument / task list) | `docs/superpowers/plans/2026-09-11-clients-projects-tasks.md` |

If the plan and spec disagree, **the spec wins**. Record a `Ruling:` in the SDD ledger and keep going.

Read both files once at start. Do **not** make implementer subagents read the whole plan; use the SDD `task-brief` script (or extract that task’s section) per dispatch.

## Product (already decided)

- Tasks module tree: **Client → Project → Task**. No subtasks (`parentId` gone).
- Client is a **Tasks-module** entity. **Do not** enable CRM (`CRM_MODULE_ENABLED` stays false). **Do not** link to CRM Company.
- Documents workspaces stay unrelated.
- Existing Dexie **projects become clients**; each gets a **General** project; current tasks land there. Subtasks flatten to sibling tasks.
- Unassigned tasks → **General** client → **General** project.
- UI: T3-style **two-level sidebar** (client folders, nested project rows). Tasks only in the center / list — **not** a third indent.
- Click project → select that project’s tasks. Click client → all tasks for that client.
- Projects kanban columns = projects of the **selected client**. Empty state if no client selected. No Uncategorized column.
- Disk: `TASKS/<client>/<project>/<taskId>/`. Do **not** delete old `TASKS/<oldProjectName>` folders.
- Names: `toLocaleLowerCase('tr-TR')`. Clients unique globally; projects unique **within a client**. Max 80 chars.
- i18n: always `src/i18n/en.ts` **and** `src/i18n/tr.ts`.
- TDD as the plan writes it. `npx vitest run <file>`, `npm run typecheck`. One commit per plan task.

## Repo facts

- App: TABS, Tauri 2 + React + Zustand + Dexie (`ZenEditorDB` currently **v12**).
- Plan commits already on `main`: spec `docs: spec Clients to Projects to Tasks (drop subtasks)`; plan `docs: add Clients-Projects-Tasks implementation plan`.
- `main` may have **unrelated uncommitted WIP** (icons, editor, CRM CSS, etc.). Worktree from a clean commit that **includes the spec+plan**. Do not scoop unrelated dirty files into this feature.
- User’s live app data is IndexedDB in the **installed** app (`com.tabs.app`). You are changing **source**. Do not wipe their production IndexedDB.

## Start

1. Create worktree/branch e.g. `feat/clients-projects-tasks` from the commit that has the spec+plan.
2. Run SDD workspace/ledger for this plan file.
3. Pre-flight scan of the 14 tasks (shared files/interfaces) → ledger table + rulings.
4. Dispatch Task 1 (pure migrator). Then 2…14 as written.
5. Final whole-branch review. Then finishing-a-development-branch (stop before merge/push).

## Stop only if

- Irreversible/destructive (delete user data, force-push, merge to main)
- Security-sensitive
- Plan is so broken every path is a guess

Otherwise **rule and continue**. Do not ask the human to pick UI nits or re-open Client-vs-CRM.

## Done looks like

- All 14 tasks complete in the ledger with review clean or parked-with-ruling
- `npm run typecheck` and `npm test` pass
- Grep has no leftover production `parentId` / `createSubtask` / `builtin_task_subtasks`
- Left Tasks nav shows Clients tree; General under each migrated client; no subtask composer
- You report: branch name, commits, rulings list, what you did not merge
