# TABS Codex CLI Implementation Plan

Date: 2026-09-23
Status: Implementation plan complete; application implementation has not started.
Target: Windows Tauri desktop. Browser/Vite remains a development preview.
Revision: 2026-09-23 user instruction removes native network isolation as a blocking requirement.

## 1. Decision And Scope

Replace every direct AI provider with the installed OpenAI Codex CLI. In this
plan, "OpenAI CLI" means the Codex executable, `codex`, not an HTTP API client.
The release has one AI runtime: Codex using the user's ChatGPT sign-in.
There is no API-key entry, custom model endpoint, API fallback, or second CLI.

The current task is planning only. All implementation checkboxes below remain
future work. Only planning documents change in this task.

Planning defaults for the unanswered earlier questions:

- Keep Documents, Tasks, CRM, Forms, Settings, Terminal, and the current assistant.
- Support contextual chat, document editing, task planning, business actions,
  and Codex-native file/command work. Preserve existing feature behavior.
- Preserve old chats, agent/persona prompts, quick prompts, actions, instructions,
  task change history, and business data. Old API chats remain readable.
- Offer an explicit "Continue with Codex" handoff into a new linked thread.
  Importing unrelated external Codex or T3 sessions is outside this release.
- Run one AI job at a time across TABS; queue further submissions durably.
  Allow switching workspaces and reading other threads while a job runs.
- Keep work running while the window hides to the tray. Full application exit
  stops execution. Restart restores state and offers controlled resumption.

"Remove APIs" covers model requests, model discovery, provider catalogs,
provider credentials, and Exa/Tavily/Brave/Firecrawl search setup. It does not
mean removing Tauri IPC, local domain-service interfaces, updates, document
exports, or unrelated networking. Codex itself still uses OpenAI services;
this is local application hosting, not offline inference.

## 2. Plan Precedence

This document replaces the previous CLI pilot proposal at this same path and
supersedes [TABS_WORK_OS_HARNESS_PLAN.md](../../../TABS_WORK_OS_HARNESS_PLAN.md)
as the implementation sequence for this restructuring. Do not combine their
phase lists or execute that plan's old migration instructions.

The user's 2026-09-23 revision removes native-command network isolation as a
prerequisite for implementation and release. Network observations are informational
throughout P0-P8; see section 8. This supersedes earlier handoff reports that blocked
implementation because localhost remained reachable with `networkAccess:false`.
The observed behavior remains recorded; it is not reclassified as successful denial.

| Earlier harness decision | Decision for this implementation |
|---|---|
| TABS owns the model/tool iteration loop | Codex owns model calls and its native agent loop |
| Direct provider adapter and API keys | A single Codex protocol adapter; no direct model HTTP |
| Preserve provider credentials and remove chats | Remove TABS provider credentials; preserve chats and prompts |
| Frontend runtime controls native execution | Rust supervises Codex; an app-lifetime TS service bridges local data |
| New schema versions 13 and 14 | Current source already declares version 14; allocate later versions |
| Custom shell/file tools duplicate agent tooling | Codex owns native tools; TABS exposes business operations |
| Broad harness roadmap | The ordered scope and release gates in this document |

Retain domain services, revision checks, durable receipts, scoped context, local
storage, and execution independent of sidebar mounting. A Run Center redesign,
autonomous schedules, external MCP marketplace, subagent orchestration, remote
services, and additional CLIs are deferred.

## 3. Inspected Baseline

These are source findings from the current dirty checkout, not installed-app
verification. Preserve all existing user edits during implementation.

| Existing surface | Finding and required treatment |
|---|---|
| [useStreamingChat.ts](../../../src/hooks/useStreamingChat.ts) | Loads keys, composes context, searches, streams chat, and invokes the app tool loop. Extract context and replace execution. |
| [useAgentLoop.ts](../../../src/hooks/useAgentLoop.ts) | Repeatedly invokes the OpenAI-compatible streamer. Remove after callers migrate. |
| [aiTools.ts](../../../src/services/aiTools.ts) | Six generic native tools and in-memory approvals; replace with Codex native tools plus the domain bridge. |
| [taskAIPlanner.ts](../../../src/services/taskAIPlanner.ts) | Separate completeChat caller. Reference search found tests but no production importer; confirm reachability, port useful draft validation, or remove the unused API entry point. |
| [aiStore.ts](../../../src/stores/aiStore.ts) | Mixes personas, provider seeding, defaults, preferences, and search credentials. Split responsibilities. |
| [chatStore.ts](../../../src/stores/chatStore.ts) | Persists threads/messages but keeps global streaming flags. Move execution state to per-thread sessions. |
| [db.ts](../../../src/services/db.ts) | Schema reaches version 14; earlier upgrades contain destructive chat clears. Test actual upgrade paths. |
| [secureStorage.ts](../../../src/services/secureStorage.ts) | Desktop keyring and browser storage also hold ordinary preferences. Migrate preferences before removing general access. |
| [search.ts](../../../src/services/search.ts) | Separate search HTTP path; replace with supported Codex web search. |
| [lib.rs](../../../src-tauri/src/lib.rs) | Registers secrets, search, terminal, and AI tools. Add focused Codex commands; retire unused AI commands. |
| [default.json](../../../src-tauri/capabilities/default.json) | Contains provider hosts and broad HTTP scopes. Remove obsolete access after auditing remaining consumers. |

T3-FORK reference checkout: `C:/AGORA/03_PROJECTS/T3-FORK`.
Inspected files:

- `apps/server/src/provider/Layers/codexLaunchArgs.ts` launches app-server.
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts` handles handshake,
  start/resume, and native events. Its automatic fresh-thread fallback must not
  silently masquerade as a successful resume in TABS.
- `apps/server/src/provider/Layers/CodexAdapter.ts` maps protocol requests into
  application events, including approvals and dynamic tool requests.

Borrow lifecycle and event-normalization patterns. Do not copy T3's Node server,
Effect stack, Electron packaging, remote routes, or provider catalog.
TABS must launch independently with the installed CLI and no T3 process.

## 4. Selected Architecture

This is the proposed TABS design, not existing implemented behavior.

```text
TABS React views
  -> app-lifetime CodexSessionService + Zustand projections + Dexie
  -> narrow Tauri adapter in src/services/codex/
  -> Rust CodexHost (owned process, protocol, pending requests, event journal)
  -> installed codex app-server over stdin/stdout

Codex business-tool request
  -> Rust correlation and session-scope validation
  -> app-lifetime TABS domain bridge
  -> approved domain transaction + operation receipt
  -> result returned to the same Codex request
```

| Owner | Responsibilities |
|---|---|
| Codex | Authentication storage, model calls, native agent loop/tools, native history and compaction |
| Rust CodexHost | Discovery, owned process tree, framed protocol, timeouts, cancellation, pending requests, replayable delivery |
| CodexSessionService | Queue, TABS/native thread mapping, context snapshots, normalized state, domain dispatch |
| Domain services | Business validation, revisions, approval enforcement, transactions, receipts, UI refresh |
| React | Compose, inspect progress, approve/deny, answer questions, view results, stop/retry/resume |

Use Rust with the existing Tauri stack; no new Node sidecar or development server.
Use piped structured messages, not PTY scraping or one shell command per prompt.
Terminal remains a separate user-operated workspace.

Official documentation describes app-server as the rich-client integration and
stdio as JSONL. Its dynamic-tool interface is experimental. Generate contracts
from the selected binary, record its version, and gate unsupported capabilities.
See [Codex App Server](https://learn.chatgpt.com/docs/app-server).

## 5. Native Host And Contract

Proposed new source locations; adapt naming to existing conventions:

- `src-tauri/src/codex/{mod,discovery,process,protocol,session,journal}.rs`
- `src-tauri/src/commands/codex.rs`
- `src/services/codex/{types,desktopClient,sessionService,eventReducer,contextBuilder,domainBridge,migration}.ts`
- `src/stores/codexStore.ts` and `src/types/codex.ts`
- `src/services/domain/` for commands extracted from current stores.

The frontend contract exposes discover/status, connect, begin/cancel login,
list models, create/resume thread, submit/interrupt turn, answer approval/input,
reply to a business tool, subscribe/replay events, and disconnect.
Expose no generic executable launcher or raw JSON-RPC forwarding command.
Validate every argument and calling window at the native boundary.

Implement request correlation, notification routing, incremental UTF-8/JSONL
decoding, partial frames, bounded frames/buffers, and separate sanitized stderr.
Unknown notifications become diagnostics. Unknown actionable requests receive a
protocol-compatible failure, never approval. A transport failure settles every
pending request with an actionable error.

Discovery order: explicit user-selected path, then installed CLI on PATH.
Resolve Windows npm shims to a supported launch target without interpolating
prompts or paths into shell code. Show the resolved path/version. Do not install
or upgrade automatically, or search arbitrary application internals for a binary.
Preserve required Windows/proxy/certificate environment settings while removing
model API-key injection and endpoint overrides from the child environment.

Own only processes started by TABS. Use a Windows Job Object or equivalently
verified process-tree ownership; hide console windows. Spawn lazily for the active
session, stop idle owned processes, and resume saved native threads as needed.
Never attach to or terminate T3, another terminal session, or all Codex processes.
Test spaces and Unicode in executable and workspace paths.

Proposed defaults: 15-second startup/handshake timeout, 30-second ordinary RPC
timeout, 5-second graceful interruption/exit interval, then termination of the
owned tree if needed. Running turns have no ordinary RPC wall-clock cutoff.
Approval/input waits are visible states. Stream silence alone is not a crash.

## 6. Authentication And Models

Replace provider management with one "Codex" settings section: CLI path/version,
connection state, ChatGPT sign-in status, reconnect, sign-in, model/reasoning
defaults, and sanitized diagnostics.

Codex supports ChatGPT sign-in and API-key login, so installation alone is
insufficient. Require ChatGPT mode and let Codex own credentials. Cached login
can be shared with other clients, so account changes have shared consequences.
See [OpenAI authentication](https://learn.chatgpt.com/docs/auth).

- Check effective auth mode through the protocol; do not read/copy auth files,
  print credentials, or put tokens into Dexie, logs, exports, or React.
- Reuse compatible ChatGPT sign-in. Otherwise offer browser login; device flow
  is available only when the tested binary/account supports it.
- If the existing login is API-based, show setup required. Changing that shared
  login must be an explicit user action, not a startup migration.
- Do not blindly apply forced-login settings to a shared home: official guidance
  says mismatched credentials can be logged out. Inspect status first.
- Preserve global config and CODEX_HOME. Use verified per-process overrides and
  reject an incompatible effective provider instead of silently accepting it.
- "Disconnect" stops TABS-owned sessions. Shared-account sign-out is a separate,
  explicit action naming its consequence; never part of migration cleanup.
- Discover models and supported reasoning settings. Never guess mappings from
  old API model IDs. Use the reported default initially; visibly resolve a saved
  selection that becomes unavailable.
- Remove API price/cost controls and unsupported generation parameters.
  Show reported usage/limits and distinguish estimates from measurements.
- Cover missing binary, unsupported version, signed out, wrong auth mode,
  connecting, ready, rate limited, offline, and crashed states.
  Non-AI work remains usable in every state.

## 7. Assistant And Context Behavior

Replace execution inside useStreamingChat with a thin session-service call.
Initialize the controller at application startup, outside sidebar components.
Unmounting ChatInput or switching mode must not interrupt or retarget a run.

Capture workspace ID, connected roots, document/task/client/project/settings
binding, selected model, reasoning, permission profile, persona, instructions,
and attachments at submission. Do not resolve the "currently active" workspace
again when a delayed tool call arrives.

Preserve selected text, editor selection coordinates, unsaved editor content,
task comments, scoped client/project context, and the existing settings context.
Extract these from the hook into tested context builders. Send bounded snapshots
with source IDs/revisions and visible truncation, not the entire database.

Keep a stable native thread for ongoing Codex conversations. Send new input and
relevant context changes; do not replay the complete rendered transcript each
turn. Codex owns compaction. TABS may display reported context usage but must not
invent exact native token counts from its old API estimates.

Keep supported images and text/file attachments. Validate capability, size,
encoding, and path before submission. Use app-managed temporary staging for
picker images when needed, record ownership, and clean only TABS-owned artifacts.
Extract DOCX/PDF content through existing supported local adapters where available;
otherwise show an explicit unsupported attachment result. Never silently drop it.

Retain quick prompts, personas, action groups, editor selection commands, task
draft previews, apply/undo behavior, and settings assistance. Represent one-off
actions as typed requests through the same Codex session service. If the old
standalone task planner is unused, remove its API entry point and reuse its
validation for the supported task-draft workflow rather than reviving dead code.
Structured task output is validated before the existing preview/apply boundary.

UI work includes ChatInput, ChatThread, AssistantMessage, ToolCallBubble,
ReasoningDropup, ModelsPanel, ModelSwitcher, the context panel, standalone chat,
agent editors, and settings. Replace provider selectors with Codex model choices.
Display native tool activity, file diffs, business results, questions, approvals,
partial output, errors, queued status, and interruption state. Keep keyboard
operation, focus restoration, scrolling, and both English/Turkish strings.

Web search uses Codex's supported search controls and citation events. Preserve
the user's opt-in intent; if unavailable under the tested version/policy, disable
the control with an actionable state. Do not fall back to a separate search API.
Browser preview keeps a deterministic fake adapter for development tests and a
desktop-required state for actual execution; it cannot spawn a real CLI.

## 8. TABS Business Tools

Use app-server dynamic tools as the selected bridge for this release. Do not
introduce a listening HTTP service or an external MCP dependency. P0 must prove
the experimental bridge on the supported binary before domain/UI work expands.
If it fails, stop that implementation gate and revise the bridge design; do not
secretly reintroduce direct APIs or ship business controls that do nothing.

Advertise only implemented, schema-validated tools in the active scope. Use
names such as tabs_tasks_create rather than colliding with native tool names.
Register matching tool versions when creating or resuming a native thread.
An old thread requiring incompatible tools is read-only until explicitly migrated
or handed off; unknown tools fail without mutation.

| Domain | Required first-release operations |
|---|---|
| Documents | Read selected/current content, list scoped documents, propose edits, apply approved revision-checked edits, create documents, use existing export actions |
| Tasks/projects/clients | Read scoped records, create/update tasks and subtasks, assign to valid projects, add comments, explicit soft-delete, preview and undo supported changes |
| CRM | Read scoped contacts/companies/deals, create/update validated records, change stages, attach notes and task links |
| Forms | Read definitions/submissions, create/update drafts, connect local submission results to CRM/tasks; keep existing manual rendering/submission flows |
| Settings | Read safe context and update an allowlisted set of ordinary preferences after approval; no credentials, arbitrary config, or permission escalation |
| Files/commands | Codex native tools with the selected permission profile, output/diff rendering, and filesystem refresh |

Extend existing document/task/CRM/forms services and Zustand actions. Extract
shared validation from UI-only handlers where needed. Never let Codex edit Dexie
files or invent database write scripts. The CLI receives tool results, not direct
access to browser storage. Preserve foreign keys, timestamps, task projection
files, assignment rules, editor format conversion, and undo invariants.

Tool request handling must follow this order:

1. Correlate the owning process, execution epoch, app/native thread, turn, and
   call ID. Validate the tool name/version and bounded JSON arguments.
2. Resolve scope from the captured session, then verify entity existence and
   expected revisions. Documents use editor revision plus disk hash where relevant.
3. For mutation, create an immutable proposal with a stable operation ID,
   target list, before/after preview, argument hash, and expected revisions.
4. Persist approval before displaying it. Bind the decision to that exact proposal.
   A changed target, argument, or revision needs a fresh proposal.
5. Execute the domain command and write its operation receipt atomically in the
   owning database. Repeated delivery returns the receipt, not another mutation.
6. Refresh the relevant UI/store and return structured success, rejection,
   conflict, partial success, or failure to the matching live protocol request.

CRM/Forms use a separate database. Add receipts there as well: no cross-database
atomicity claim. A cross-feature workflow has independent recorded steps and
shows partial completion. Use stable created IDs and resume unfinished steps
without duplicating successful ones. Filesystem changes require write-ahead
intent, before/after hashes, and reconciliation; shell effects are not automatically
replayed and cannot be promised exactly-once or reversible.

Default to approval for TABS mutations; scoped reads need no repeated prompts.
Use Codex's supported approval/sandbox choices for native tools. Keep the two
approval sources visually clear. Do not promise that workspace-write requests an
approval for every write. Map old Bypass preferences to the new safe default,
never to unrestricted execution.

For document/business mode, use native read-only access and domain-approved
writes. Coding mode grants only selected roots under a tested sandbox profile.
A working directory is not a sandbox. Test actual read/write boundaries,
junctions, symlinks, path traversal, and sandbox setup failures on Windows.
Unsupported required filesystem enforcement blocks coding tools instead of
silently escalating.

Native-command network isolation is not a requirement for this release, by the
user's 2026-09-23 instruction. Record requested network settings and observed
behavior as informational compatibility evidence. Failed or unavailable network
denial must not block P0, dependent implementation, coding tools, packaging, or
release acceptance. No required check may fail solely because network denial is
not enforced. Repeating network-denial probes or repairing network isolation
is not a prerequisite to continuing implementation.

On this Windows installation, the tested Codex 0.155.1 allowed synthetic localhost
HTTP/TCP access with `networkAccess:false`, including after elevated setup. This
is an accepted limitation, not proof of internet access or successful network
isolation. Keep supported sandbox settings and report their actual behavior;
do not promise offline or network-isolated native execution. This revision does
not require changing global Codex configuration or selecting unrestricted access.
Filesystem limits, mutation approvals, credential protection, inherited-tool
restrictions, and the separate web-search opt-in remain required.

Keep application databases, credentials, and runtime journals outside writable
coding roots. Before native writes to an open editor file, resolve unsaved-change
conflicts; watch external changes and never overwrite newer disk/editor content.
Audit inherited Codex MCP/plugins/hooks and provider settings. Use supported
per-process controls to prevent unadvertised tools from bypassing TABS choices;
if those controls cannot enforce the profile, report incompatibility and block it.
Never change the user's global Codex configuration to make a test pass.

## 9. Persistence, Cancellation, And Recovery

Keep chatThreads/chatMessages for display and add separate session/run tables.
Proposed records:

| Record | Minimum fields |
|---|---|
| CodexSession | appThreadId, nativeThreadId, runtime=codex, binaryVersion, toolSchemaVersion, auth identity reference without tokens, workspace scope, model/effort, timestamps |
| CodexRun | runId, appThreadId, clientCommandId, nativeTurnId, executionEpoch, status, submitted context/options snapshot, timestamps, error |
| RunEvent | runId, host epoch/sequence, native item ID, normalized type, bounded payload, timestamp |
| PendingRequest | request ID, native correlation, kind, proposal/input schema, status, expiry/invalidation reason |
| OperationReceipt | stable operationId, proposal hash, affected IDs, before/after revisions, outcome and recovery details |
| MigrationState | version, step, exact pending cleanup account names, completion/error state; never secret values |

Use the next available Dexie version after implementation rechecks the current
maximum (14 at inspection). Keep domain receipts with their owning database.

State transitions: queued -> starting -> running -> completed/failed/cancelled.
Running can enter awaiting_approval or awaiting_input, then return to running.
Disconnection creates interrupted/recovery_required, not automatic completion.
Cancelling remains visible until interruption is acknowledged or the owned
process has exited; completed effects remain recorded.

Use one durable scheduler and one active run. A unique clientCommandId deduplicates
double-clicks and reconnecting submitters. Keep streaming state keyed by thread/run,
not a single global boolean. A new workspace selection cannot redirect pending work.

Rust maintains a bounded local delivery journal under application data, with
monotonic sequence/epoch and acknowledgement. Persist normalized, sanitized events;
exclude auth responses and sensitive environment values. Dexie holds the UI
projection and domain receipts. Replay by sequence and reconcile native items by
ID after reconnect; do not blindly append text deltas twice. Rotate only acknowledged
journal segments, preserve terminal results, and handle disk-full/corruption visibly.

Start subscribers before sending commands. Mark a submitted turn accepted only
after its native identity is known. If the pipe breaks between request and reply,
inspect native history before retrying; an uncertain submit must not be resent
automatically. Never execute a write from replayed presentation events.

Sidebar close and tray hide retain the app-lifetime controller. Renderer reload
or loss of the domain bridge interrupts native work and refuses new business
mutations until recovery; do not claim headless domain execution through a dead
WebView. Use bridge readiness/heartbeat and flush/replay to cover this boundary.

On full quit/update, stop admissions, settle or reconcile in-flight domain writes,
interrupt turns, reject pending requests, flush records, and terminate only owned
process trees. On restart, increment the execution epoch, reconcile receipts and
native history, invalidate stale approvals, then offer resume. Never resend an
approval response into a new process just because the numeric request ID matches.

A missing native thread keeps the TABS transcript readable. Offer an explicit
new-thread handoff with bounded selected history and source linkage. Mark it as
a handoff, never as native resume. Cancellation is not undo; show completed changes.

## 10. Data And Credential Migration

Do not run any migration against the user's current data during this planning task.
For implementation, gate AI startup on a repeatable migration and keep ordinary
workspaces usable when cleanup needs repair.

1. Recheck schema versions, storage keys, and historic upgrades. Create a local,
   consistent pre-migration backup of TABS business data/chats/settings with provider
   and search secret fields redacted; verify counts and a restore fixture.
   Do not export Codex auth or create a new plaintext backup of old keys.
2. Preserve chat IDs/content/timestamps/bindings, personas, prompts, instructions,
   actions, task drafts/change history, document/workspace state, and CRM/Forms data.
   Mark old chats legacy_api; do not manufacture native thread IDs.
3. Migrate ordinary preferences out of secure storage (activeAgentId and applicable
   display settings) into Dexie. Map valid agent IDs to preserved agents.
   Discard provider/model routing defaults; choose Codex defaults on first connection.
4. In a Dexie transaction, write the new schema/settings and a cleanup manifest
   containing exact TABS-owned credential account names, then remove provider rows,
   inline apiKey fields, API catalogs, and obsolete routing/search settings.
5. After that transaction commits, delete only matching TABS credentials under
   the com.tabs.app keyring service. Existing provider accounts use
   providerApiKey_<providerId>; include known historic names and scoped orphan
   enumeration only after source/namespace verification. Never delete the whole
   keyring namespace or touch another application's credentials.
6. Remove exaKey, tavilyKey, firecrawlKey, braveKey, searchProvider, and the search
   enabled setting only after confirming ownership. Remove stale activeProviderId,
   appManagementProviderId, provider hidden-model IDs, and old task-model defaults
   from their actual stores. Preserve unrelated settings.
7. Clean only old TABS browser credential entries under tabs:web-secure: and the
   corresponding tabs:web-secure-key after migrating required nonsecret preferences.
   Do not use localStorage.clear or erase unrelated browser/application data.
8. Keep a narrowly scoped native cleanup command for upgrades, replacing general
   secret_get/secret_set access after preference migration. Journal failures and
   retry idempotently; report pending cleanup rather than claiming keys are gone.
9. Mark migration complete only when table changes, preference migration, and
   cleanup verification succeed. Do not reseed deleted API providers on later boot.

Keychain and Dexie cannot share a transaction: the cleanup manifest survives
crashes between them. Test failures before/after every stage. Test both current
version 14 and older supported databases; amend historic destructive chat-clearing
upgrades if they would erase supported users' data before the new migration.

A rollback is a tested app/data restore, not an API toggle inside the new release.
Keep the pre-migration backup and previous installer; do not overwrite them with
the migrated database. Restoring must be explicit and account for newer user work.
Removed API credentials are not restored by the redacted backup. Do not change,
revoke, back up, or delete the shared Codex login as part of TABS migration.

## 11. Removal And Replacement Inventory

Delete only after all production references have migrated. Audit test utilities,
startup seeding, localization, bundled assets, and scripts as well as live UI.

| Surface | Final treatment |
|---|---|
| src/services/ai/openai.ts, gemini.ts, router.ts | Remove direct streaming/completion clients |
| src/services/ai/importProviderModels.ts and provider-only tests | Remove endpoint probing and remote model import |
| src/services/ai/types.ts, reasoning.ts; src/data/reasoningCatalog.json | Remove API-only protocol/catalog data; retain shared concepts only after moving them to Codex contracts |
| src/hooks/useAgentLoop.ts | Remove app-owned model/tool loop |
| src/hooks/useStreamingChat.ts | Thin service facade; no credentials, fetch, native process, or tool loop |
| src/services/taskAIPlanner.ts | Preserve required draft parsing/validation through Codex, or remove unreachable API helper |
| src/stores/aiStore.ts | Preserve personas/instructions; remove provider CRUD/seeding/key logic; Codex settings in the new store |
| src/components/settings/ModelsContent.tsx and modelProviders/ | Replace provider management with Codex connection/model settings |
| src/components/modals/modelProvider/ and shared model controls | Remove custom endpoints/provider selection; adapt reusable model UI |
| src/components/settings/tools/SearchToolDetail.tsx and ToolsList.tsx | Remove search-provider key forms; show supported native search/tool settings |
| src/services/search.ts; src-tauri/src/commands/search.rs | Remove Exa/Tavily API execution and search_web registration |
| src/services/aiTools.ts; src-tauri/src/ai_tools/ | Retire duplicate native-agent dispatch after checking all users; retain terminal and filesystem infrastructure used outside AI |
| src/services/secureStorage.ts; src-tauri/src/commands/secrets.rs | Replace general secret access with narrowly scoped upgrade cleanup after moving ordinary preferences |
| src/types/index.ts and persisted keys | Remove active API-provider contracts; keep explicit legacy-read types where needed |
| proxy.mjs, vite.config.ts, scripts/sync-models-dev.mjs | Remove AI proxy/catalog machinery once references are confirmed; preserve unrelated Vite behavior |
| package.json, Cargo.toml, lockfiles, capabilities, CSP | Remove dependencies/permissions used only by APIs; retain required updater/image/export networking |
| en.ts, tr.ts, README and active specs | Describe Codex setup and supported limits; remove API-key onboarding |
| Old provider-specific tests and fixtures | Replace with Codex/migration behavior coverage; do not retain dead production adapters to satisfy old mocks |

Audit all runtimeFetch consumers before deleting the HTTP helper/plugin. Removing
AI APIs does not authorize breaking unrelated network features. Retain narrow
migration-only legacy names and historical documents where required; the final
runtime must contain no callable API-provider path or hidden fallback.

## 12. Ordered Implementation Work

All items are pending. Internal development may temporarily contain both old and
new code, but no release or user-facing runtime selector retains the API path.
Do not migrate live user data merely to test an intermediate phase.

### P0. Baseline And Codex Compatibility Proof

- [ ] Preserve dirty work; record relevant diffs and existing check failures.
- [ ] Discover the installed CLI without modifying it. Record path/version and
  inspect help/schema. Generate protocol fixtures from that exact version.
- [ ] Prove a TABS-owned stdio session: handshake, compatible sign-in detection,
  model discovery, two turns, native thread resume, streamed output, approval,
  question/input reply, dynamic tool reply, interrupt, and owned-process exit.
- [ ] Prove Windows sandbox behavior and supported per-process configuration.
  Require filesystem and approval enforcement; record network behavior without
  requiring network isolation to pass. Test a fake app business tool without
  touching real TABS records.
- [ ] Record a tested CLI version/range and capability matrix. Recheck when the
  binary changes; do not claim all future versions work.

Files: compatibility tests/fixtures under the proposed Codex modules.
Gate: the actual installed CLI can support this design without API keys. Failure
of a required capability blocks dependent work; it does not reverse the user's
Codex-only decision. Network isolation is excluded from this gate under section 8.
Carry the existing localhost result as an accepted limitation and continue once
the remaining P0 requirements are satisfied; do not restart passed probes.

### P1. Typed Contract And Native Process Host

- [ ] Add the modules in section 5 and a deterministic fake child-process fixture.
- [ ] Implement discovery, typed command validation, framing, request correlation,
  diagnostics, startup/timeout behavior, event delivery, and process-tree cleanup.
- [ ] Register commands in lib.rs and align native permissions/capabilities.
- [ ] Test fragmented frames, malformed/oversized output, EOF, noisy stderr,
  missing binaries, space/Unicode paths, and killing only owned descendants.

Depends on P0. Gate: Rust tests, formatting, and compile checks pass; protocol
round trips and cleanup work independently of React.

### P2. Durable Session Service And Recovery

- [ ] Add session/run/event/request/receipt contracts and additive test schemas.
- [ ] Implement the app-lifetime controller, one-run scheduler, submission
  deduplication, per-thread status, captured scope, journal replay, and projections.
- [ ] Implement interruption, quit/tray/reload behavior, uncertain-submit
  reconciliation, native resume, and explicit fresh-thread handoff.
- [ ] Test crash boundaries, duplicate/out-of-order events, disk-full errors,
  stale epochs/requests, and workspace switches during a pending turn.

Depends on P1. Gate: a two-turn conversation survives UI remount and an interrupted
session recovers without duplicate messages, submissions, or writes.

### P3. Codex Setup And Core Chat

- [ ] Build connection/auth/model settings and remove provider dependence from the
  new chat path. Keep all onboarding state nonsecret.
- [ ] Route ChatInput/useStreamingChat through the service; extract context builders.
- [ ] Adapt conversation rendering, model/reasoning controls, context display,
  attachments, search intent, stop/retry/resume, and standalone chat.
- [ ] Verify live model/reasoning effects, expired/wrong login behavior, native
  approvals, input requests, and readable legacy messages.
- [ ] Update English and Turkish copy and keyboard/accessibility behavior.

Depends on P2. Gate: packaged-capable native chat works with no key entry, while
Documents/Tasks/CRM/Forms remain usable if Codex is absent.

### P4. Domain Commands And Business Bridge

- [ ] Extract shared document/task/CRM/forms validation and mutation commands.
- [ ] Implement scoped dynamic tools, immutable proposals, approval enforcement,
  stable operation IDs, same-database receipts, and cross-database step recovery.
- [ ] Preserve task draft preview/undo, document revision checks, assignment rules,
  projection files, and record relationships.
- [ ] Add unknown-tool, wrong-session, stale-revision, duplicate-call, rejection,
  partial-commit, and domain-bridge-loss tests.

Depends on P2 and the proven P0 bridge; integrate with P3 UI.
Gate: a fake Codex tool request can perform each supported operation exactly as a
manual domain action would, with visible persisted results and safe retry behavior.

### P5. Complete Workspace Workflows

- [ ] Finish remaining existing AI entry points, personas, quick prompts, action
  groups, editor selections, task planning, and safe settings assistance.
- [ ] Prove workflow A: summarize the active unsaved document, propose a follow-up
  task, approve once, then see the saved task linked to its source conversation.
- [ ] Prove workflow B: read a local form submission, propose a CRM change and task,
  generate a document summary, and verify each approved result in its workspace.
- [ ] Prove coding flow: selected folder, native file/command activity, approval
  where required by the selected profile, conflict-aware editor refresh, and stop.
- [ ] Repeat the workflows with rejection, stale content, interrupted transport,
  and partial completion; verify no repeated business records.

Depends on P3 and P4. Gate: all scope in section 1 works through Codex, including
the hidden/one-off AI callers, with no behavior depending on a direct provider.

### P6. Migration And Complete API Removal

- [ ] Implement the staged migration and scoped cleanup in section 10 with fixture
  databases, fake keyring, restart injection, and verified restore coverage.
- [ ] Replace/delete every obsolete surface in section 11; remove provider seeds,
  models catalogs, API configuration screens, proxy routes, and search keys.
- [ ] Preserve legacy conversations and prompts; implement explicit handoff.
- [ ] Remove general key retrieval/creation from the renderer, retaining only
  necessary preference migration and constrained legacy-secret cleanup.
- [ ] Remove unused dependencies and AI-specific permissions/CSP entries.
  Audit remaining HTTP uses before removing shared infrastructure.

Depends on P5. Gate: clean install and upgrades have no API onboarding, no active
provider rows/secrets after successful cleanup, and no runnable direct-AI path.
All preserved record counts/relationships and legacy message contents match.

### P7. Full Regression And Native Failure Matrix

- [ ] Run focused TS/Rust suites, then the full repository gates below.
- [ ] Inspect source and production bundle for removed callers, endpoint URLs,
  provider credentials, proxy routes, startup seeds, and obsolete UI.
  Allow only documented migration/test/history references.
- [ ] Exercise missing CLI, unsupported version, wrong/expired login, rate limits,
  network loss, malformed protocol, child crash, pending approvals during exit,
  file locks, renderer reload, and application restart.
- [ ] Verify document open/save/export, tasks/calendar, CRM, forms/submissions,
  terminal, updates, layout, and keyboard behavior remain intact.

Depends on P6. Gate: all required checks pass or clearly identified pre-existing
failures are resolved through their own scoped work before release acceptance.
Network-isolation observations remain non-blocking under section 8. Never mark
the full gate green because a focused suite passes.

### P8. Package, Install, And Accept

- [ ] Build Windows Tauri packages from the actual candidate tree.
  If the running app locks the usual executable, use an isolated CARGO_TARGET_DIR;
  do not kill the user's working app to replace its build output.
- [ ] Test from the packaged executable without Vite, T3, or a Node development
  server. Node may be needed only if the user's chosen CLI installation requires it.
- [ ] Test clean install and upgrade using isolated test data, then perform the
  authorized real upgrade with a verified backup and explicit migration report.
- [ ] Verify discovery from a normal Start-menu launch, login, two turns, model
  selection, native approval, both business workflows, interruption, tray, quit,
  restart, and no orphaned owned children.
- [ ] Record exact source/check/bundle/install/live-UI evidence separately.
  Report unsigned installers honestly if updater signing is unavailable.

Depends on P7. Gate: the installed Windows application passes the release
acceptance matrix. A browser preview or a successful build alone cannot satisfy it.

Critical path: P0 -> P1 -> P2 -> P3/P4 -> P5 -> P6 -> P7 -> P8.

## 13. Verification Commands And Acceptance

These are implementation-time commands, not commands claimed as run for this
documentation task. Use the package scripts already defined in package.json.

Frontend gate from the repository root:

```powershell
npm run check
```

Native gates from src-tauri:

```powershell
cargo fmt --check
cargo check
cargo test
```

Packaging from the repository root:

```powershell
npm run tauri:build
```

During implementation, first run the narrow suite for the changed slice, such
as Vitest tests in src/services/codex or targeted Codex Rust tests. Use fake
process/protocol fixtures for repeatable failures; reserve real CLI turns for
native compatibility and final acceptance. Never send production records in tests.
Do not weaken tests/types/capabilities or fix unrelated WIP merely to get green.

| Acceptance area | Required evidence |
|---|---|
| API removal | No key fields, provider settings, custom endpoints, search keys, direct model/search HTTP, seeded providers, or API fallback in the final runtime |
| Authentication | Existing ChatGPT sign-in works; missing/wrong/expired login is actionable; shared Codex credentials remain owned by Codex |
| Sessions | Two turns preserve native context; switching views does not retarget work; restart distinguishes native resume from handoff |
| Controls | Selected model/reasoning/search settings affect the native turn, or unsupported choices are disabled |
| Approvals | Correct target/details, approve and deny, question replies, invalidation after cancellation/restart, no automatic escalation |
| Business work | Both workflows have visible persisted results, revision checks, stable receipts, no duplicate records, and understandable partial completion |
| Documents | Unsaved content and selections work; disk/editor conflicts do not lose edits; existing save/export behaviors survive |
| Legacy data | Old chats, personas, instructions, prompts, task history, and business records survive; cleanup is resumable and scoped |
| Lifecycle | Sidebar/tray, reload, child crash, quit/update, restart, pending requests, and owned-tree cleanup are verified |
| Isolation | Another CLI/T3 session and its config/login/processes are not modified by TABS cleanup |
| Native network behavior (informational) | Requested settings and observed limits are documented; network denial is not a prerequisite for implementation or release acceptance |
| Packaging | Runs from an installed Windows build without development servers; CLI location/version status is accurate |
| Browser preview | Fake adapter only for tests; real execution clearly requires desktop; no accidental API fallback |
| Regression | Existing non-AI workspaces, terminal, updates, local file access, and accessibility still work |

Store human review reports/screenshots/task backups under the configured
C:/Users/burak/MOTHER/DOCS topic folder unless the user selects another location.
Application-managed migration backups, journals, and caches use their operational
data directories. Keep test fixtures in source and ordinary build outputs in the
toolchain's required locations.

## 14. Risks, Technical Gates, And Completion

The product scope is decided; there are no unanswered provider/API choices.
These technical facts must be established during P0/P7/P8:

- Installed CLI path/version, actual sign-in mode, entitled models, and limits.
- The pinned version's experimental dynamic-tool behavior and schema compatibility.
- Effective required filesystem/approval enforcement and inherited config/tool
  restrictions; observed native network behavior is informational under section 8.
- Reliable domain operations while the application is hidden, and safe interruption
  when its renderer/bridge is unavailable.
- Upgrade coverage for supported historical databases and interrupted keyring cleanup.

Record the supported CLI range and fail with a useful compatibility status after
an incompatible upgrade. Do not automatically replace the binary, downgrade policy,
or add API credentials to work around incompatibility.

Completion means the final installed TABS build uses only Codex for AI, has no
direct AI/search provider integration, preserves the selected user data, and
passes the native acceptance matrix. The user can still use non-AI workspaces
when Codex is unavailable. No remote TABS service is introduced.

Planning validation for this change: check local links, document structure,
scope coverage, whitespace, and the final file diff. Application tests, CLI login,
live turns, migrations, building, installation, and UI acceptance belong to the
future implementation and must not be reported as completed by this plan.
