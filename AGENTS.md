# AGENTS.md — TABS Repository Guide

## Purpose and precedence

This file applies to the entire repository. It defines the default working rules for coding agents; a more specific `AGENTS.md` in a subdirectory overrides it for that subtree.

Higher-priority platform/system/developer instructions remain binding. Within
them, follow the current user request and explicit approvals, applicable project
rules and existing conventions. A named plan/spec describes the selected work;
it cannot grant execution, remote-access or publication authority. A task record
or status change also grants none of those permissions.

This root is sufficient for ordinary local work by any coding agent, including
Hermes. Product integration restrictions below do not ban Hermes as a coding
agent. Resolve routine choices within the requested scope; review-only means
no edits. Preserve unrelated work and application data. Destructive/system-wide
actions, installations and external sharing require explicit task-specific scope.
BRAIN is read-only through tools/delegates; VAULT is excluded. Only when work
involves cross-project outputs, plans, owner context, ATLAS or system operations,
read `../../AGENTS.md` and relevant destination rules. Local outputs use
MOTHER/WORKSPACE; durable context/inbox/Work use ATLAS_MEMORY, not BRAIN
(systems/methods/patterns). Self-contained local work needs no VPS connection.

Do not revive deleted Hermes, VPS, `server/`, `deploy/`, or hosted-web requirements from git history unless the user explicitly asks to restore them.

## Workspace and delivery

Location/workflow notes; dated operational observations below are historical:

- Active local checkout: `C:\Users\burak\MOTHER\DEV\TABS-local`, branch `main`.
- Source remote: `https://github.com/brandpreneuragency/APPS_TABS.git` (`origin`).
- A current VPS source checkout has not been verified. The scoped lookup of
  TABS-named folders under the resolved ATLAS project root found no candidate;
  do not assume a second checkout or a local/VPS source synchronization job.
- Source transfer uses explicitly authorized, scoped Git commits/pushes. No
  general project mirror or automatic deployment is configured by these rules.
- Delivery is a Windows Tauri build/installer, separately verified from source
  changes. The updater retains the older `brandpreneuragency/TABS` URL, which
  GitHub resolved to the same `APPS_TABS` repository on 28 September 2026.
  No hosted application deployment is implied.
- Burak requested VPS task authority on 27 September 2026. The task-only
  implementation is under `tools/task-authority`, `src/services/taskAuthority`
  and `src-tauri/src/task_authority.rs`. Historical installed-app migration was verified
  on 28 September 2026: 58 tasks, 17 task clients, 17 projects and 11 comments
  match the original backup and VPS, including all attachments. The VPS
  checkpoint was restored and compared separately. Consult live
  `ATLAS_TASKS/AGENTS.md` and the VPS status receipt for subsequent changes.
  Preserve the local cache and original migration backups. Never
  expose Codex session tools as a remote API or import Markdown projections.

## Product source of truth

TABS is a **local desktop application** built with Tauri.

- Documents, CRM data, settings, agents, and AI-provider credentials are handled locally.
- The explicit task-authority exception uses VPS SQLite over existing SSH for
  task clients, projects, tasks and comments. After migration, Dexie is the
  offline cache. No task existence/status dispatches a Hermes execution job.
- There is **no** hosted TABS web application, Hermes Gateway, remote session service, Docker deployment or Caddy configuration. The task-only SSH authority above is the explicit VPS exception; other application data remains local.
- **Vite/browser mode** (`npm run dev`) is a development preview only — not a supported production runtime.
- Production packaging and day-to-day use target the Windows Tauri desktop app.

Keep the React UI separate from Tauri service adapters. Feature code should go through `src/services/` (runtime, folder connectors, FS adapter, HTTP helpers) rather than importing `@tauri-apps/*` directly in components.

### Current task-authority contract

Source rechecked on 5 October 2026; this is not a live VPS/installed-app check.
See [the task-authority guide](tools/task-authority/README.md) only when that
subsystem is relevant. `src-tauri/src/task_authority.rs` fixes transport to
`admin@atlas-vps`, resolves atlas-map and calls the task-only JSON RPC; it does
not expose arbitrary SSH commands. Keep that account; do not invent a new one.
`tools/task-authority/tasks.py` and `src/services/taskAuthority/model.ts` agree
on `clients`, `projects`, `tasks`, `taskComments` (Task clients, not CRM).
Preserve compare-and-set revisions, idempotent operation receipts, explicit
deletion intents/tombstones, authority identity/generation guards, durable
pending requests and visible conflicts. Missing cache rows are not deletions.
Active task-to-project and project-to-client relations are checked; do not
restore old parent/subtask assumptions from earlier reviews or history.
Markdown is a secondary projection, never import authority or permission to run
a plan. Projection retries must preserve manual edits. Real data, migration,
acceptance SSH and restoration require the matching task scope; prefer isolated
fixtures and do not connect to production merely to verify local source edits.

## Required start-up checks

Before editing:

1. Run `git status --short` and inspect relevant diffs. This repository may contain substantial user WIP.
2. Read every file you intend to change and search all references to affected symbols, selectors, commands, persisted keys, and types.
3. Identify which runtime is in scope: Tauri desktop (primary) or browser/Vite (dev preview only).
4. Confirm acceptance criteria and verification commands for the active scope.

Use `rg` for repository searches. Do not infer system behavior from a single component.

## Repository map

- `src/components/<area>/`: React feature and shared UI components.
- `src/stores/`: Zustand state and persisted application state.
- `src/services/`: runtime adapters, persistence, AI providers, filesystem access, search.
- `src/hooks/`: shared React behavior.
- `src/types/`: cross-feature TypeScript contracts.
- `src/i18n/`: English and Turkish UI strings.
- `src/styles/` and feature CSS files: tokens, shell layout, and scoped feature styles.
- `src-tauri/src/`: Rust desktop commands, AI tools, tray, and terminal backend.
- `src-tauri/capabilities/`: Tauri permission scopes.

Generated or runtime data is not source: `node_modules/`, `dist/`, `src-tauri/target/`, and `src-tauri/TASKS/`.

Do **not** reintroduce `server/`, `deploy/`, Hermes clients/stores, remote folder connectors, or `tabsApi` unless explicitly requested.

## Runtime and architecture rules

- Primary runtime: Tauri desktop → `TauriFolderConnector`.
- Dev preview: browser → `BrowserFolderConnector` (File System Access API). No remote connector fallback.
- Keep runtime detection in `src/services/runtime.ts` and FS access behind `src/services/fs-adapter.ts` / `FolderConnector`.
- Browser-only features must degrade safely when native APIs are unavailable.
- Tauri command changes must stay aligned across Rust registration, frontend invocation, and `src-tauri/capabilities/default.json`.
- Preserve stable component identity for editors, AI sidebar chat, forms, and selections.
- Put shared state invariants in Zustand actions. Use narrow selectors in large components.
- Follow existing Dexie patterns for persisted settings; migrate or delete obsolete keys deliberately (e.g. ignore/delete stale `chatMode`).

Shell workspace modes are local only: Documents, Tasks, CRM (including Forms), Settings, plus Terminal. The AI Assistant sidebar’s `SidebarTab = 'chat'` is the local multi-provider assistant — not a Hermes workspace.

## Implementation conventions

### TypeScript and React

- Strict TypeScript is enabled. Do not hide errors with `any`, `@ts-expect-error` without cause, or broad casts.
- Prefer small, explicit types and pure helpers for logic that can be unit tested.
- Keep feature components in their existing area and shared primitives under `src/components/ui/`.
- Preserve accessibility: semantic controls, keyboard behavior, visible focus, accurate labels.
- Add or update Vitest tests for non-trivial logic and regressions (`*.test.ts` / `*.test.tsx` under `src/`).
- When user-facing copy changes, update both `src/i18n/en.ts` and `src/i18n/tr.ts` unless intentionally unlocalized.

### Styling

- Reuse tokens from `src/styles/tokens.css` and existing feature classes before adding new values.
- Keep structural styles in scoped feature CSS; inline styles only for dynamic geometry or CSS variables.
- Audit `min-width: 0`, `min-height: 0`, overflow ownership, and responsive behavior when changing nested layouts.
- Remove obsolete selectors when their final use is removed, but do not perform unrelated global CSS cleanup.

### Rust and Tauri

- Keep commands focused and return actionable errors without leaking sensitive data.
- Update capability scopes narrowly; never broaden filesystem, shell, or HTTP permissions merely to make a failing call pass.
- Run Rust formatting and compile checks when Rust or Tauri configuration changes.
- Distinguish the local debug executable from the installed application when diagnosing desktop behavior.

## Security

- Never print API keys, access tokens, secure-storage values, or `.env` contents in commands, logs, tests, diffs, or chat.
- Provider credentials and local data stay on the user’s machine; do not add cloud sync or remote credential bridges unless explicitly requested.

## Scope and repository safety

- Make the smallest coherent change that satisfies the active request.
- Preserve unrelated modifications and untracked files.
- Do not add or upgrade dependencies unless the task requires it and no existing dependency fits.
- Do not commit or push unless the user explicitly asks.
- Never run destructive Git commands (`git reset --hard`, `git clean -fd`, bulk `git restore`, force-push) without explicit authorization.
- Do not weaken TypeScript, ESLint, tests, or Tauri capabilities to make a check pass.

## Verification

Choose verification by changed target: documentation gets link/script and diff
checks; frontend logic gets relevant tests (`npm run test -- <test-file>`),
touched-file lint and applicable typecheck. `npm run typecheck` is project-wide;
state that scope rather than presenting it as a single-file check.

The full gate below runs typecheck, lint, all tests **and build**, not just a
frontend smoke check. Use it when acceptance or integration scope warrants it:

```powershell
npm run check
```

For Rust or Tauri changes, from `src-tauri/`:

```powershell
cargo fmt --check
cargo check
```

Use `npm run tauri:build` when packaging is part of acceptance. Report browser preview and Tauri desktop results separately. Never claim a command passed unless it was actually run.

## Handoff format

End implementation work with:

- Summary and files changed
- Behavior and migration notes
- Commands run and exact results
- Remaining risks or unverified paths

<!-- verified-project-workflow:2026-09-28 -->
## Source copies and historical Git checkpoint

Recorded 28 September 2026, Europe/Istanbul; remote redirects/HEAD equality are
historical observations, not current online verification.

- Primary source: `C:/Users/burak/MOTHER/DEV/TABS-local`, main tracking
  origin/main. Both local and GitHub main resolved to
  `c4efee27a8a12ee0d3862289fbca44c60b0b2b8d`; existing uncommitted changes
  are separate and were preserved.
- Canonical source repository: `https://github.com/brandpreneuragency/APPS_TABS`.
  GitHub currently redirects the older brandpreneuragency/TABS name to this
  same repository. Different URL spellings do not prove separate repositories.
- Clients v2 execution copy: `C:/Users/burak/MOTHER/DEV/TABS-Clients-v2-run`.
  This is a separate clone, not a linked worktree. Local inspection on 5 October
  2026 still found detached HEAD and origin pointing at the nonexistent historical
  `C:/Users/burak/MOTHER/PROJECTS/TABS-local`, not this active DEV checkout.
  That is an unresolved transfer blocker, not permission to fix the remote.
  Do not switch its branch, rewrite its origin or add unrelated edits while
  that run is working. Its latest phase commit is a changing runtime fact.
- Any Clients source-commit authorization belongs only to its selected run;
  confirm the current request/receipt rather than inferring it from this inventory.
  It never expands to pushes, installer or production.
  Integration into the primary dirty checkout requires reviewing the selected
  candidate and existing changes; copying files wholesale is not a merge.
- No VPS TABS source checkout was found under the resolved ATLAS project root.
  The task-only VPS data service is separate from source-code synchronization.
- Source `.github/workflows/release.yml` declares draft desktop release builds
  for v* tag pushes. Updater configuration retains the old TABS URL alias.
  Verify the actual release target and packaging/signing state before publishing.
