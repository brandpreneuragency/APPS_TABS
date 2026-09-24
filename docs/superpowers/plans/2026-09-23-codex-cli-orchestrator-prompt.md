# TABS Codex CLI Implementation Orchestrator Prompt

Use this entire document as the implementation prompt in a new coding-agent session.
Creating this prompt does not execute implementation or change the installed app.

## Mission And Authority

Implement the complete [TABS Codex CLI Implementation Plan](2026-09-23-cli-runtime-restructuring-proposal.md)
in `C:/AGORA/03_PROJECTS/TABS-local`, using parallel subagents for independent work.
Continue through implementation, verification, packaging, and all authorized desktop
acceptance. Do not stop after another plan, scaffolding, or a chat-only demo.

Read the plan in full and follow applicable AGENTS.md files. Its original "planning
only" wording describes the task that produced it; this execution prompt authorizes
source implementation. All product requirements, technical gates, and acceptance
criteria still apply. The older TABS_WORK_OS_HARNESS_PLAN.md is superseded.

User-approved revision, 2026-09-23: native-command network isolation is no longer
a prerequisite for implementation or release. Network observations are informational
throughout P0-P8. The observed Codex 0.155.1 localhost access with
`networkAccess:false` is an accepted limitation; it must not block implementation,
disable coding tools, or prevent packaging/acceptance. This supersedes older
handoff entries that stopped work on network denial. Preserve the evidence and
apply the revised gate; do not relabel the failed denial test as a pass.

The decided scope:

- Codex CLI with ChatGPT sign-in is the sole AI runtime. Remove direct AI/search
  providers, API-key UI/storage, custom endpoints, catalogs, and API fallback.
- Preserve Documents, Tasks, CRM, Forms, Settings, Terminal, the assistant, chats,
  personas, prompts, instructions, actions, task history, and business data.
- Use installed `codex app-server`, Rust-owned structured stdio, an app-lifetime
  TypeScript session service, and approved local business operations.
- Implement durable queueing with one active TABS AI run, captured workspace scope,
  approvals, cancellation, recovery, and explicit legacy-chat handoff.
- Keep Windows Tauri as the production runtime. Browser/Vite is development preview.
  "Remove APIs" excludes Tauri IPC, domain interfaces, exports, and unrelated HTTP.
- This prompt requires development subagents. Product-level subagent orchestration,
  additional CLIs, hosted services, and a new workspace redesign remain deferred.

Use `C:/AGORA/03_PROJECTS/T3-FORK` as a read-only architectural reference. Adapt Codex
lifecycle/event patterns, not its server, Electron stack, remote services, or provider
catalog. TABS must operate without a T3 process or development server.

## Models And Reasoning

User-approved worker revision, 2026-09-23: use xAI Grok 4.7 for difficult workers
and independent critical review, and xAI Grok 4.6 for bounded workers. This replaces
the previous worker model assignments. Keep the parent orchestrator's current model.

| Assignment | Provider / requested model | Reasoning | Work |
|---|---|---|---|
| Difficult workers | xAI / Grok 4.7 | Runtime-supported setting; record it | Architecture, Rust host, protocol, concurrency, recovery, migrations, business transactions, integration defects |
| Bounded workers | xAI / Grok 4.6 | Runtime-supported setting; record it | Targeted inventories, fixtures from agreed contracts, mechanical call-site changes, established UI patterns, EN/TR copy, removal audits, documentation |
| Independent critical reviewer | xAI / Grok 4.7 | Runtime-supported setting; record it | Process ownership, sandbox/auth isolation, data loss, stale approvals, duplicate mutations, cross-layer regressions |

Use actual runtime model/reasoning controls, not model names only in task prose.
Resolve the exact xAI model identifiers from the executing runtime's model catalog;
the names above are requested model names, not invented API IDs. Do not carry over
the previous `xhigh`/`max` effort values without verified support for the chosen
model. Use its exposed default if no effort was requested or no selector is offered.
Inspect available delegation capabilities. Record requested and effective settings
where exposed; never claim an unobservable setting was verified. Avoid fixed-role
presets that override the requested model/effort. If full-history inheritance blocks
overrides, send a fresh, self-contained task brief with the necessary context.

If Grok 4.6 is unavailable but Grok 4.7 is available, use Grok 4.7 for bounded work
and report the substitution. Do not silently replace unavailable xAI workers with
another provider or downgrade critical work to Grok 4.6. Report unavailable worker
assignments and continue useful independent work in the parent. Do not change global
configuration or install another runtime to obtain a model. If delegation tools are
unavailable, report that limitation; never pretend parallel agents were run.

Escalate Grok 4.6 work to Grok 4.7 when it reveals ambiguous behavior, shared invariants,
migration/protocol design, or repeated unexplained failures. These are development
model choices. TABS must discover its available Codex models and supported reasoning
settings instead of hardcoding the development team's model choices.

## Parallelism And Ownership

Use up to three concurrent workers plus the parent, within the actual runtime limit.
Workers must not spawn agents. Reuse or close finished workers. Delegate concrete,
independent work; keep dependencies ordered. The parent should integrate, make
contract decisions, or validate while workers run.

Before each batch, publish a compact worklist: task, phase, model/effort, owner,
exclusive files, dependencies, validation command, and status. Distinguish pending,
running, blocked, implemented, and verified. A worker's "done" is not acceptance.

Exactly one writer owns each file, including tests. Assign explicit file lists or
nonoverlapping directories after inspecting the checkout. The parent owns shared
integration files by default: src/App.tsx, shared types, database schemas, native
command registration, permissions/configuration, manifests/lockfiles, and both
localization catalogs. Transfer ownership explicitly when needed. Domain workers
request shared-file changes from the integrator instead of editing concurrently.

Freeze the minimal contract before parallel consumers implement it: commands, events,
IDs/epochs, errors, capabilities, run transitions, queue semantics, tool schemas,
proposal/receipt shapes, and database ownership. Coordinate contract changes with
affected workers and tests before continuing. Avoid competing abstractions.

Preserve the dirty checkout. Do not create branches, commits, stashes, or worktrees,
or reset/clean/restore files, without explicit authorization. A clean HEAD checkout
would omit the user's WIP. Shared-checkout worker edits are already present: inspect
and integrate them rather than replaying patches. Obtain a handoff before reassigning
a running worker's files.

Use one build/package coordinator to avoid output collisions. Parallel read-only
checks must use isolated fixtures/data. Final checks run on a stable candidate after
writers stop; invalidate affected results if that candidate changes.

## Startup And P0

1. Read the plan and applicable instructions. Run `git status --short`, inspect
   relevant diffs without exposing credentials, and record existing dirty/untracked
   work so it is not attributed to this implementation.
2. Recheck scripts, schema versions, source entry points and completed work. The plan's
   baseline may have drifted; do not assume schema version 14 or restart verified work.
3. Start up to three independent discovery assignments:
   - xAI Grok 4.7: installed-CLI compatibility proof, generated protocol/schema,
     dynamic tools, Windows sandbox and owned-process lifecycle, using synthetic data.
   - xAI Grok 4.6: targeted AI entry-point/removal inventory, including hidden callers,
     settings, provider/search setup and the plan's section 11 removal checklist.
   - xAI Grok 4.6: historic-upgrade/data/credential ownership inventory and fixture needs.
     Inspect schemas and key names, never secret values; make no live mutations.
4. Meanwhile, the parent establishes ownership, maps requirements to tasks, and runs
   appropriate baseline checks, recording exact existing failures.
5. Consolidate P0 evidence before dependent implementation: handshake, ChatGPT mode,
   models, two turns, native resume, streaming, approval/question replies, a dynamic
   tool reply, interrupt, owned exit, and required Windows filesystem/approval
   enforcement. Record native network behavior as informational evidence, plus
   binary path/version, generated schema and supported capabilities. Verify current
   official documentation where necessary.

P0 is a real gate for required protocol, authentication, business-bridge, filesystem,
approval, owned-process exit, and inherited-tool controls. If those capabilities
fail, stop dependent work, report the exact evidence, and continue independent
inventory or fixtures. Network isolation is excluded: do not stop implementation,
or require repeated network-denial probes or repairs before proceeding, solely
because network denial is unavailable or ineffective.
Use the existing evidence and continue once the remaining P0 requirements are met.
Do not substitute direct APIs, broaden filesystem permissions, fake successful
network denial, or install/upgrade Codex automatically. User-interactive login is a
specific blocker; preserve shared login/configuration and continue independent work.

## Implementation Waves

Follow P0-P8 and their dependencies exactly. Parallel tasks inside a phase are useful;
a dependent phase cannot pass on mock evidence. Temporary old/new source coexistence
is allowed during development, but no final runtime selector or API fallback survives.

| Phase | Ownership and parallel work | Exit evidence |
|---|---|---|
| P1: typed contract/native host | Parent owns shared contract/registration; Grok 4.7 implements Rust host; Grok 4.6 creates agreed deterministic process/protocol fixtures in separate test files. | Native round trips, framing/error/timeout cases, owned cleanup, Rust format/check/tests; independent of React. |
| P2: durable sessions/recovery | Grok 4.7 owns scheduler/service/replay/epochs; parent or another Grok 4.7 owns separate database/journal files; Grok 4.6 builds agreed reducer/recovery fixtures. | Two turns, remount, uncertain submit and restart without duplicate output, submissions, or effects. |
| P3 + P4: chat and business bridge | After P2, run P3 UI/context work alongside P4 domain work. Grok 4.7 owns critical chat lifecycle and domain proposals/receipts; Grok 4.6 handles bounded UI/context work. Split domain areas only after shared contracts and ownership are agreed. | Native no-key chat, integrated approval/input UI, each advertised domain operation validated. |
| P5: complete workflows | Integrate P3/P4; check independent workflows with isolated fixtures. Grok 4.7 fixes cross-layer defects; Grok 4.6 finishes defined call sites. | Workflow A, workflow B, coding flow, rejection/conflicts and partial recovery through the same runtime. |
| P6: migration/API removal | After P5, Grok 4.7 owns migration/scoped cleanup; Grok 4.6 removes agreed obsolete surfaces in disjoint files. Parent integrates shared types, dependencies, permissions and translations. | Preserved clean/upgrade fixture data, resumable secret cleanup, zero runnable direct-AI/search path. |
| P7: hardening/review | Independent Grok 4.7 reviews integrated code; Grok 4.6 checks removal coverage/regressions; parent runs full gates and coordinates relevant fixes. | Plan fault matrix, full checks, domain regressions, resolved critical findings. |
| P8: package/accept | Parent coordinates packaging and isolated installation/upgrade; workers inspect evidence without editing the candidate. | Actual Windows package/install/live-UI evidence, separate from browser and unit tests. |

Do not split migrations across writers or delete P6 code before P5 callers migrate.
Do not start every table role at once. At each gate, review/integrate results, execute
focused checks, update acceptance tracking, then dispatch the next eligible wave.

## Integration Invariants

- Rust owns only TABS-launched processes, correlation, sanitized diagnostics and
  journal delivery. Cover fragmented/oversized frames, EOF, timeouts, unknown messages
  and pending requests. Expose no raw RPC or generic executable-launch UI command.
- The app-lifetime service owns one durable scheduler, stable thread mapping, captured
  context and deduplicated projections. Tray/sidebar behavior, renderer loss, full
  quit, uncertain submits and restart must follow the plan's explicit lifecycle.
- Bind tools to captured scope, thread/turn, epoch, call ID, version and revisions.
  Never resolve delayed writes against whichever view is currently active.
- Business mutations require durable immutable proposals and matching approval.
  Write receipts atomically with effects in their owning database. CRM/Forms and
  main storage are separate: expose partial completion, not false cross-database
  atomicity. Validate every operation and preserve relationships/undo invariants.
- Replay/retry cannot repeat effects. Invalidate stale approvals on restart/cancel;
  reconcile filesystem writes and never promise exactly-once shell work.
- Preserve unsaved editor content/selections and check revisions/hashes before edits.
  Reconcile native filesystem changes with open editors and refresh the relevant UI.
- Codex owns authentication, models, native tools and compaction. Preserve shared
  login/config; do not read/copy tokens or inject keys/endpoint overrides. Unsupported
  capabilities have useful disabled/error states. Keep non-AI work usable.
- Implement the plan's business/coding permission profiles. A working directory is
  not confinement. Test junction/path/sandbox boundaries and refuse silent escalation.
- Native network isolation is not guaranteed or required. Keep supported sandbox
  settings, document the observed limitation, and treat network-denial results as
  non-blocking. Retain filesystem limits, approvals, credential protection,
  inherited-tool restrictions, and the separate web-search opt-in.
- Preserve personas, prompts, actions, task preview/apply/undo, attachments, search
  opt-in, preferences, legacy transcripts and EN/TR UI. Distinguish native resume
  from explicit new-thread history handoff.
- Migration uses new schema versions, redacted backups, restore tests, exact TABS
  credential names and resumable cleanup. Never clear chats or another app's secrets.
  Audit consumers before removing shared HTTP/keyring infrastructure.
- UI goes through src/services adapters. Keep validation in domain services/actions,
  strict types, existing design conventions, stable component identity and accessibility.

## Validation And Acceptance

Before each substantive edit, read the owning code and references, state a testable
local hypothesis and choose a focused check. Run that check immediately after the
first edit, repair the same slice before expanding, and add meaningful regressions
for lifecycle, migrations and business effects.

Use deterministic process/protocol fixtures and isolated databases for repeated tests.
Real CLI probes prove native compatibility; fake/browser adapters do not. Never use
production records as test prompts or migrate live data to test intermediate phases.
Do not print .env contents, auth files, tokens, API keys or secure-storage values.

Required final commands; record actual exit codes and results:

```powershell
# Repository root
npm run check

# src-tauri/
cargo fmt --check
cargo check
cargo test

# Repository root, after integration gates
npm run tauri:build
```

Complete the plan's full section 13 acceptance matrix, including:

1. Workflow A: summarize the active unsaved document, propose and approve a follow-up
   task once, and verify its persisted result linked to the source conversation.
2. Workflow B: turn a local form submission into approved CRM/task changes and a
   document summary; verify each result and recover partial steps without duplicates.
3. Coding flow: selected roots, native tools, policy-correct approval, unsaved-file
   conflicts, external change refresh, interruption and owned-process cleanup.
4. Upgrade: transcript contents and preserved records/relationships match; preference
   migration and scoped secret cleanup survive interruption and restart.
5. Lifecycle/isolation: workspace changes, tray, renderer reload, child crash, offline,
   quit/update, restart, stale requests, and a separate existing CLI/T3 session.
6. Installed desktop: normal Start-menu discovery/login, two turns, effective model,
   reasoning/search controls, approvals/questions, business workflows and no orphaned
   owned children, without Vite or T3.

Run the full final gate on a stable candidate and repeat affected checks after fixes.
Separate baseline failures from regressions. Do not weaken checks or fix unrelated
WIP to manufacture green results. Existing unrelated failures remain explicit release
blockers until handled in their own authorized scope.
The user-approved network-isolation revision applies here too: no required check
may fail solely because native network denial is unavailable or ineffective. Record
that behavior as an accepted limitation; all other acceptance requirements remain.

Use an isolated CARGO_TARGET_DIR if the running app locks normal output; do not kill
the user's app for packaging. Report unsigned artifacts and missing updater signing
accurately. Keep source checks, bundle, isolated install, real install and live UI as
distinct evidence levels.

Complete authorized preparation and isolated acceptance before requesting any missing
authorization for real installed-app replacement, live migration or shared-account
changes. Reuse approvals already present. Otherwise leave a concrete tested candidate,
verified backup/restore procedure and exact remaining action. Do not mark P8 complete.

## Worker Brief And Review

Every task must include:

```text
Task / phase:
Requested provider/model, resolved model ID, and supported reasoning setting:
Objective and acceptance criteria:
Plan sections and relevant current code:
Verified dependencies / agreed contract:
Exclusive writable files:
Read-only references / forbidden files:
Behavior and data-preservation invariants:
Focused validation commands:
Return: files changed, behavior, exact checks/results, unresolved risks,
and shared-file changes requested from the parent.
Do not expand scope, change contracts, spawn agents, commit, or touch live data.
Report blocking dependencies promptly; do not weaken a gate to work around them.
```

The parent reviews actual diffs and integration, not summaries alone. An independent
Grok 4.7 reviewer checks protocol, recovery, migration and business mutations. Findings
identify file/symbol, trigger, consequence and needed validation. Return fixes to the
owner, then rerun affected checks and review.

## Persistence And Completion

Continue authorized work without asking whether to proceed after each phase. Provide
concise progress updates. Maintain a resumable ledger of phase/task status, ownership,
contract decisions, candidate identity, commands/results, blockers and next action.
Store standalone reports/screenshots/task backups under the configured
C:/Users/burak/MOTHER/DOCS topic folder unless explicitly directed elsewhere. Source
fixtures, operational journals and build outputs keep their required locations.
Respect actual filesystem permissions; do not change them to finish an artifact.

After compaction, resume from the ledger and current diffs. Do not restart completed
foundations or repeat unaffected checks. If blocked, finish independent authorized
work, settle owned agents/processes, and state the precise blocker and remaining
action. Do not leave required test/build sessions unattended.

Finish with behavior and files changed, migration effects, actual agent/model
assignments, commands/results, package location/signing, installation/live evidence
and outstanding blockers. Completion requires the plan's actual gates, not a mock,
worker summary or successful build alone.

Begin with startup checks and the bounded parallel P0 assignments above.

## Orchestration References

Explicit per-agent models/reasoning and bounded parallel work are supported patterns;
check the executing runtime's actual controls before dispatch. See official
[Codex subagent guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents)
and the [model catalog](https://developers.openai.com/api/docs/models). These describe
Codex delegation patterns; they do not establish xAI worker availability or local
CLI compatibility. Verify xAI worker IDs and controls in the executing runtime.
