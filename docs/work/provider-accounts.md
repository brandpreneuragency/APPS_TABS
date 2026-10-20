# Provider accounts and connection dashboard

## Current state

- Status: scoped implementation and independent review complete, VERIFIED WITH DEFERRED ITEMS; no supported code blocker. Focused source, protocol, persistence, browser-preview checks and native debug build pass. Native UI and four-account authenticated acceptance remain incomplete; no owner accounts have been signed in by this work.
- Execution: Hermes Agent on MOTHER, `C:/Users/burak/MOTHER/DEV/TABS-local`, branch `main`.
- Goal: add a TABS module for four independent Codex accounts, their five-hour/weekly limits, remaining reset tokens, and account observations for MOTHER Hermes, ATLAS Hermes, MOTHER OpenCode and VPS OpenCode.
- Selected record: this file, approved by Burak. Keep future iterations here; no duplicate Kanban task or per-session plan.
- Next step: run the updated Tauri desktop UI under an explicitly selected acceptance/delivery scope, then complete the four owner logins sequentially and verify identity, live limits and restart persistence. The installed app has not been updated; do not direct the owner to a module in that unchanged installation. Do not describe configured identities as per-request active accounts.

## Scope and acceptance

1. Add a discoverable module in the existing Tauri/React shell, not a separate hosted web app.
2. Keep provider account identity/connection metadata reusable; keep usage observation separate from AI Chat execution. Do not change existing chat login, account selection, threads or execution behavior in this iteration.
3. Start with four Codex account slots. Each managed login uses an isolated Codex home and the supported Codex login protocol; never replace existing Hermes/OpenCode/Codex credentials.
4. Display five-hour and weekly windows, reset times, remaining reset tokens where actually provided, per-account last-success/attempt status, and manual/periodic refresh. Missing data is unknown, not zero/full quota. Never infer a refill merely from the local clock.
5. Show all four named consumer locations. Distinguish runtime-confirmed identity from stored/configured identity; unreachable or unsupported runtime evidence is explicitly unknown, never a fabricated active binding. Never use matching email alone as proof of the same quota account/workspace.
6. Keep credential/token material out of frontend responses, logs, test fixtures and repository files. Do not clone native credentials between applications/hosts. Do not expose arbitrary SSH or shell execution.
7. Verify account isolation, duplicate identities, unavailable/partial limits, refresh failures preserving last-good data, late-response ownership, and shell navigation. Run relevant frontend tests/lint/typecheck, Rust formatting/check/tests and a real isolated Codex-protocol/native flow. Source checks, preview smoke, native smoke and real-account acceptance must be reported separately.

## Architecture decisions

- A small shared provider-account contract is the boundary for future providers and later AI Chat account selection. Usage adapters and consumer-observation adapters are separate from chat adapters.
- Native account auth/usage collection belongs under its own `src-tauri/src/provider_accounts/` module. Frontend access goes through `src/services/providerAccounts/`; dashboard components stay under their own feature directory.
- Use the supported Codex app-server account protocol rather than replaying Hermes tokens against private subscription endpoints.
- Account metadata and snapshots are local native application data; this is not a task-authority feature or a new general VPS API.
- No commits, push, installer promotion, production service installation, automatic quota reset or automatic account switching are authorized by this record.

## Constraints and open limits

- Burak says the other Codex accounts are not signed into another application. Real four-account acceptance requires owner-completed login flows; that does not block isolated implementation/tests.
- Existing source chat integrations include Codex and CLI adapters for Grok, CommandCode and OpenCode. They are not refactored into this module in the initial delivery.
- Installed Codex 0.159.2 schema exposes `rateLimitResetCredits.availableCount` and duration-tagged rate-limit windows; parsing is covered, but four authenticated responses remain unverified. External probes establish configured identity only. VPS OpenCode's running/store selection is ambiguous and remains unavailable; per-request identity is NOT implemented for any external consumer.
- Startup Git status showed only existing unrelated untracked items; preserve them. No tracked source diff was present when implementation began.
- Deferred UI consistency: after a single-slot reconnect/refresh, another slot's duplicate flag can lag until Refresh now or periodic full refresh. No wrong-account quota exposure was found. Reconcile all sanitized metadata after a terminal login in a future bounded improvement; this is not a blocker for the reviewed source scope.

## Iteration notes

### 2026-10-20 — Hermes Agent (OpenAI Codex / gpt-6.1-sol-900k)

- Read current repository/UI contracts, source navigation, account/CLI boundaries and Git state.
- Burak selected a new persistent workstream record and requested a modular implementation that can grow to more providers without tangling with AI Chat.
- Installed tools observed: Codex CLI 0.159.2, Cargo 1.95.0, Node 26.7.0, npm 11.19.0.
- Verification: implementation checks NOT RUN yet. Earlier live Hermes usage queries cover one existing account only, not this module or four-account acceptance.

### 2026-10-20 — frontend milestone, Hermes Agent

- Added shared account/usage/consumer-observation contracts, narrow desktop adapter, and an independent Zustand module under `src/services/providerAccounts/`. Chat adapters and credential storage remain untouched.
- Added the Accounts workspace, dashboard, EN/TR copy, five-hour/weekly windows, reset-token count, pending/cancel/retry login controls and four consumer rows. Unknown/duplicate/stale/configured-vs-runtime states are explicit; old data cannot become fresh because the clock passes a reset time.
- Added ownership tests for late list/login results, cancellation, mismatched login slot, refresh failure preserving last-good usage, missing percentages/windows, binding identity and workspace routing.
- Verification: `npm run test -- src/components/providerAccounts/ProviderAccountsPage.test.tsx src/services/providerAccounts src/stores/uiStore.providerAccounts.test.ts src/components/header/ModeNavigation.test.tsx` — 5 files, 19 tests PASS. Project-wide `npm run typecheck` PASS. Touched-file ESLint PASS. `npm run build` PASS with existing chunk-size/ineffective-dynamic-import warnings. Design-token and other adjacent tests passed in the earlier broader batch; that batch initially exposed test setup/assertion issues corrected before the final focused pass.
- Baseline evidence: the existing ModeNavigation test failed before navigation edits because its Notes/Projects expected order differed from current source. Updated its expectation to preserve the existing rendered order and append Accounts; did not reorder the existing controls. One Clients test fixture needed the new default panel-state key.
- Native registration/transport tests, browser/native runtime smoke, independent review and real four-account login acceptance are NOT RUN/PENDING. Two bounded subagents own only new native account files and read-only consumer-interface discovery; parent owns integration and this record. No commits, installs or production service changes.

### 2026-10-20 — native integration and verification, Hermes Agent

- Integrated the bounded native account commands, main-window guards, isolated Codex homes/keyring identity attribution, sanitized atomic local snapshots, duplicate detection, supervised app-server lifecycle and sequential browser login guard. Added an ID-bound, origin-validated ShellExecuteW opener; no arbitrary renderer URL, shell invocation or additional Tauri permission scope.
- Integrated independent `provider_connections` read-only adapters. Parent-executed live transport smoke returned three configured identities and one `runtimeStoreAmbiguous` result. Stable identity agrees across the two Hermes locations and differs for MOTHER OpenCode; no account IDs/emails or credential material are copied into this record. None of these records is runtime-confirmed.
- Added module-boundary/extension guidance in `src/services/providerAccounts/README.md`. Existing AI Chat behavior, credentials and supported-version pin remain unchanged. Future chat must select and bind an explicit account ID rather than inherit a monitoring refresh/global default.
- Frontend final focused command with process-scoped `NODE_OPTIONS=--no-experimental-webstorage`: 8 files, 36 tests PASS (account model/store/UI, navigation, Notes/Clients adjacency, design tokens). Direct TypeScript project build, touched-file ESLint and Vite production build PASS. Existing chunk-size/dynamic-import warnings remain.
- Native: `cargo fmt --check` and `cargo check --offline` PASS. `cargo test --offline --lib provider_ -- --nocapture`: 18 PASS, 5 intentionally ignored (filter includes one existing CLI-provider regression). The four ignored `provider_accounts::` tests were then explicitly run using the built synthetic fixture: 4 PASS, including actual installed-CLI signed-out protocol and Store/persistence smoke. Exact `provider_connections::tests::live_read_smoke`: PASS. Collector Python fixtures: 12 PASS.
- Real Chromium source-preview smoke PASS: App started, Accounts selected, four connection rows rendered, desktop-only/unknown state shown without invented native responses, no horizontal overflow or runtime exceptions, return to Documents worked. Screenshot and JSON evidence live in agent scratch (`tabs-provider-dashboard-preview.png`, `tabs-provider-browser-smoke.json`); this is not native UI or authenticated quota acceptance. Owned preview/test processes were cleaned up.
- Broad verification limits: `npm run check` was interrupted/timed out and is NOT PASS. Two broader frontend suite attempts were stopped after existing TaskProjects date-label failure and unrelated GitHub/Clients failures/timeouts plus Node Web Storage warnings. A focused safe-environment rerun reproduces `TaskProjectsKanban.test.tsx:437` expecting `11.Eyl` in a top row with no date; that component/test are unchanged from HEAD. Do not broaden this feature into unrelated suite repair or claim the whole repository is green.
- An initially over-broad native `installed_` filter also selected two existing Chat smoke tests; both refused the installed 0.159.2 version against Chat's existing 0.155.1 pin before login/inference. Re-ran only the exact monitoring smoke tests successfully. The chat pin was not weakened.
- Earlier automatic Rust file lint uses Rust 2015 and misreports async syntax; edition-2021 rustfmt and actual Cargo checks are the execution evidence. Rechecked the live process environment and explicitly bound test TMP/TEMP/TMPDIR to agent scratch; no system-wide settings changed.
- Native debug build: `cargo build --offline` PASS (exit 0, 2m20s); four existing GitHub dead-code warnings. This builds the local debug executable, not an installer or installed-app update.
- Remaining acceptance at this milestone: independent combined review, actual Tauri UI/login flow and four owner-authenticated quota reads. No installed-app/installer promotion, commit, push, model inference, account switching in other apps, or reset redemption occurred.

### 2026-10-20 — independent review closure, Hermes Agent

- Single independent combined review (`deleg_9a8f7175`) returned VERIFIED WITH DEFERRED ITEMS, no supported security/core/integration blocker and zero correction rounds. Reviewed the tracked diff/new module source at HEAD `6e6153e3bc2a0d08f21b354c86fa4d87b251bb9b`, credential isolation, identity/late-response ownership, bounded commands/processes, snapshot handling and shell integration. Parent rechecked current HEAD and `git diff --check`: PASS.
- Reviewer independently read source-preview JSON/screenshot and saved broader-suite failure evidence; it did not duplicate passing execution checks or read owner credentials/SSH. Native build and latest 36-test focused run remain parent-executed evidence, not reviewer reruns.
- Accepted one non-blocking consistency limitation: another slot's duplicate metadata can lag after a single-slot mutation (`store.ts:65,117-118`). A full refresh reconciles it. Recorded once rather than expanding the feature into optional polish.
- Source implementation is ready for the next acceptance stage, not declared installed or fully authenticated. Actual Tauri UI, four distinct live account logins, keyring persistence after restart and real quota/reset-credit responses remain NOT RUN. Configured-only consumer evidence and VPS OpenCode ambiguity remain explicit; full repository suite remains non-green as above.
