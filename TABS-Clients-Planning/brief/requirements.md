# TABS Clients: handoff to the software development planner

Prepared: 2026-09-27

Target repository: C:\Users\burak\MOTHER\PROJECTS\TABS-local

Target product: Windows Tauri desktop application

Requested deliverable: an executable implementation plan for a local orchestration run with parallel subagents.

This document is the requirements and planning brief. Writing it does not launch implementation, connect a Google account, send email, migrate live data, or update the installed application. The receiving planner should produce a complete execution package from it, with dependencies, exclusive file ownership, worker prompts, verification gates, and recovery instructions.

## 1. Mission for the receiving planner

Plan a fifth main header tab named Clients. Reuse the Task List workspace's layout and interaction conventions. Keep the existing client navigation on the far left. Put the categories Overview, Profile, Conversations, and Notes in the adjacent left panel, and their content and controls in the center panel. Preserve the existing assistant sidebar.

Clients is a small relationship-management and record-keeping module for brands with several contact people. Its two primary questions are:

1. What did we last discuss?
2. What work is currently in progress?

The module must use the same client identities and existing projects/tasks as the rest of TABS. It must not establish a second, disconnected list of brands.

Plan the whole requested feature, including a real Gmail connection. Resolve implementation choices from the repository and the requirements below. Do not turn the planner handoff into another broad product interview.

The owner specifically wants all predictable interactive Google setup and live verification completed in an attended preflight, before the main unattended implementation run. Design that preparation stage explicitly. A successful preflight is not proof that the final feature works; the finished implementation still needs automated checks and isolated native acceptance.

## 2. Confirmed decisions

| Topic | Decision |
|---|---|
| Purpose | Manage existing client relationships and keep a lasting record. |
| Client identity | A brand with several contact people. |
| Scale | Approximately 20-30 brands, 2-3 contacts each, and 3-5 client emails per day. |
| Header | Docs, Task List, Calendar, Projects, Clients; existing utility controls remain. |
| Left navigation | Preserve the Task List client navigation, selection, sizing, collapse behavior, and Add client control. |
| Categories | Overview, Profile, Conversations, Notes. |
| Visual design | Existing TABS colors, typography, spacing, icons, controls, panels, and resizing behavior. |
| Communications | Gmail/Google Workspace only. |
| Connected mailboxes | One mailbox in version one; use account identifiers so a later extension remains possible. |
| Email operations | Read, search, new email, Reply, Reply all, Forward, and attachments. |
| Matching | Automatic matching by contact email, with manual linking and correction. |
| History | Start fresh; no bulk historical import. |
| Gmail read state | Reading in TABS does not mark the email read in Gmail. |
| Synchronization | While TABS is running, including existing tray operation; catch up when reopened. No service running after the app fully quits. |
| Record retention | Keep already downloaded client correspondence if its source disappears from Gmail. |
| Attachments | Download on demand, with an explicit option to retain a local copy. |
| Internal records | Call/meeting summaries, decisions, notes, and attachments. |
| Existing CRM | Passive: preserve existing CRM/Forms data and behavior, without extending or merging it into this feature. |
| AI | Preserve the current assistant; defer new email/notes AI context, summaries, reply drafting, and autonomous sending. |
| Users | One local user now; team sharing is a later project. |
| Google setup | Unknown. Investigate and complete account/project readiness during attended preflight. |
| Live verification | Required during preflight, so implementation can run without planned sign-in interruptions. |
| Orchestration | Tool-neutral local Windows execution; one parent and up to three concurrent workers, subject to actual runtime limits. |
| Completion | Implemented and tested source plus verified isolated Tauri application. No installer, installation, publishing, or production activation. |

No particular worker model, deadline, or monetary/token budget was selected. Do not import model assignments from an older project plan. Choose roles based on available capabilities and record actual assignments.

## 3. Scope boundaries and working rules

Follow the current repository AGENTS.md and more specific instructions. Re-read them at execution time.

- Preserve existing dirty and untracked work, user data, credentials, live processes, settings, and existing client/project/task IDs.
- Do not create branches or worktrees, commit, push, stash, reset, clean, restore, or migrate the installed app's data as an incidental orchestration step. The default is coordinated work in the existing checkout.
- Do not add WhatsApp, another messaging provider, hosted TABS services, a VPS backend, webhooks, Pub/Sub infrastructure, a shared team database, account permissions UI, or a browser production runtime.
- Do not add sales pipelines, leads, invoices, billing, campaign sending, bulk email, automatic follow-ups, custom-field builders, contact imports, or an AI redesign.
- Do not expose Google secrets through React state, ordinary Dexie settings, generated reports, prompts, logs, screenshots, URLs, or test output.
- Do not include any real inbox content or credentials in the planning folder. MOTHER\DOCS is synchronized storage.
- Keep migrations additive and deliberate. Do not repurpose or clear existing CRM/Forms tables.
- Keep filesystem and HTTP work behind services and native adapters. UI components must not invoke arbitrary native or network operations directly.
- New dependencies are allowed only if needed for this task and an existing dependency does not fit. The planner must justify additions, particularly native HTTP, OAuth, MIME handling, and safe email rendering.
- Use English and Turkish localization for new user-facing copy.

The output destination is:

    C:\Users\burak\MOTHER\DOCS\Work\TABS-Clients-Planning

Keep the final plan, prompts, sanitized gate reports, and related planning assets together with relative links. Operational credentials, cached mail, attachments, databases, and private test configuration belong in isolated application-managed local storage outside DOCS. General screenshots follow the workspace screenshot destination; capture synthetic content only and link to those screenshots.

## 4. Evidence available to the planner

These are observations from this conversation, not guarantees about a later checkout.

- The earlier full frontend preflight completed successfully: npm run check exited 0; 64 test files and 334 tests passed; typecheck and build passed; lint had zero errors and nine warnings. Vite reported existing chunk/dynamic-import warnings. Do not treat this as a future execution gate result.
- The 2026-09-27 inspection found no tracked source modifications. Untracked items existed, including a literal %SystemDrive% directory, progress JSON files, a root index.css, and output/playwright artifacts. Preserve and inventory them; they are not deliverables of this task.
- Package version was 1.1.3. The primary Dexie database declared versions through 18, and the CRM/Forms companion database through 2. Recheck before assigning migration numbers.
- No Gmail/WhatsApp/OAuth implementation was found in the searched application/native sources during the communication preflight.
- No Google project, consent screen, credential, mailbox, live email exchange, or new Tauri acceptance environment has been verified for this feature.
- The local Tauri build CLI supports --no-bundle and --config. Use those capabilities to verify a native executable without producing an installer.
- No implementation subagents were launched to produce this handoff.

### Source map to inspect, not blindly rewrite

| Area | Existing source and relevance |
|---|---|
| Header | [ModeNavigation.tsx](../../../PROJECTS/TABS-local/src/components/header/ModeNavigation.tsx), [Header.tsx](../../../PROJECTS/TABS-local/src/components/header/Header.tsx): four current main tabs and utility controls. |
| Main routing | [App.tsx](../../../PROJECTS/TABS-local/src/App.tsx), [AppLayout.tsx](../../../PROJECTS/TABS-local/src/components/layout/AppLayout.tsx), [CRMWorkspace.tsx](../../../PROJECTS/TABS-local/src/components/layout/CRMWorkspace.tsx): workspace selection and center rendering. |
| Navigation | [LeftNarrowSidebar.tsx](../../../PROJECTS/TABS-local/src/components/layout/LeftNarrowSidebar.tsx): client scope and shared selection. |
| Panel shell | [PrimaryWorkspaceContent.tsx](../../../PROJECTS/TABS-local/src/components/layout/workspace/PrimaryWorkspaceContent.tsx), [uiLayoutState.ts](../../../PROJECTS/TABS-local/src/stores/uiLayoutState.ts), [uiStore.ts](../../../PROJECTS/TABS-local/src/stores/uiStore.ts): resizing, visibility, persisted routing. |
| Task patterns | [TaskListPanel.tsx](../../../PROJECTS/TABS-local/src/components/taskManager/TaskListPanel.tsx), [TaskDetailPanel.tsx](../../../PROJECTS/TABS-local/src/components/taskManager/TaskDetailPanel.tsx), [TaskCommentInput.tsx](../../../PROJECTS/TABS-local/src/components/taskManager/TaskCommentInput.tsx): layout, composers, drafts, lists, attachments. |
| Existing clients | [clientStore.ts](../../../PROJECTS/TABS-local/src/stores/clientStore.ts), [types/index.ts](../../../PROJECTS/TABS-local/src/types/index.ts), [AddNewClientButton.tsx](../../../PROJECTS/TABS-local/src/components/taskManager/AddNewClientButton.tsx). |
| Work relationships | [taskSelection.ts](../../../PROJECTS/TABS-local/src/stores/taskSelection.ts), [clientOverview.ts](../../../PROJECTS/TABS-local/src/stores/clientOverview.ts), projectStore.ts, taskStore.ts. |
| Local persistence | [db.ts](../../../PROJECTS/TABS-local/src/services/db.ts), [crmFormsDb.ts](../../../PROJECTS/TABS-local/src/data/crmFormsDb.ts): separate database boundaries. |
| Passive CRM | [CRMListPanel.tsx](../../../PROJECTS/TABS-local/src/components/crm/CRMListPanel.tsx), [types/crm.ts](../../../PROJECTS/TABS-local/src/types/crm.ts), crmStore.ts, crmService.ts. |
| Assistant scope | [taskAssistantBinding.ts](../../../PROJECTS/TABS-local/src/stores/taskAssistantBinding.ts), [taskAIContext.ts](../../../PROJECTS/TABS-local/src/services/taskAIContext.ts): preserve existing behavior without adding mail/notes to context. |
| Design tokens | [tokens.css](../../../PROJECTS/TABS-local/src/styles/tokens.css), [index.css](../../../PROJECTS/TABS-local/src/index.css), layout.css, navigation.css, taskList.css. The root untracked index.css is a different file. |
| Runtime adapters | [runtime.ts](../../../PROJECTS/TABS-local/src/services/runtime.ts), fs-adapter.ts, TauriFolderConnector and BrowserFolderConnector. |
| Native lifecycle | [lib.rs](../../../PROJECTS/TABS-local/src-tauri/src/lib.rs), [tray.rs](../../../PROJECTS/TABS-local/src-tauri/src/tray.rs): window close hides the app; tray Quit exits it. |
| Native credentials | [commands/secrets.rs](../../../PROJECTS/TABS-local/src-tauri/src/commands/secrets.rs): existing narrow legacy-AI cleanup and keyring use. It is not a ready-made Gmail credential API. |
| Native configuration | [Cargo.toml](../../../PROJECTS/TABS-local/src-tauri/Cargo.toml), [tauri.conf.json](../../../PROJECTS/TABS-local/src-tauri/tauri.conf.json), [default.json](../../../PROJECTS/TABS-local/src-tauri/capabilities/default.json). |

Resolve these known integration traps:

1. A clients CRMPage value already exists, but the inspected CRMWorkspace has no Clients center-page implementation. Reuse the appropriate route instead of creating competing navigation modes.
2. LeftNarrowSidebar currently hides Everything/No Client when the clients route is selected. Its CRM branch also exposes legacy More entries. Reconcile this with the owner's requirement that the new page retain Task List's left navigation. Make only the narrow routing/visibility corrections needed; preserve navigation on existing pages.
3. Selected client/project state currently lives in taskStore. Avoid a second unsynchronized client selection. Entering the Clients page should show the whole selected brand and not inherit an invisible project filter.
4. Client creation already creates a General project. Preserve that behavior; do not create another client/project pair for its profile.
5. Current client deletion removes projects and soft-deletes related tasks. Specify how new profile/contact/record references survive that existing operation. Do not introduce a new cascade that silently erases correspondence.
6. Current secret helpers use the configured application identifier as the keyring service. Isolated acceptance must still verify actual namespaces, rather than relying on an older warning about hardcoded namespaces or a different executable filename.
7. Existing CRM Contact/Company/Lead types do not establish a link to the task-module Client identity. Do not equate similarly named records automatically.

## 5. Required screen and interaction design

### 5.1 Shell and navigation

Use this hierarchy:

    Header: Docs | Task List | Calendar | Projects | Clients
    Existing client navigation | Category panel | Category content | Existing assistant

The category panel is the equivalent of Task List's left content panel. It is not a replacement for the far-left client navigation.

- Add Clients after Projects; exactly one main header tab is active.
- Reuse panel geometry, resize handles, collapse controls, assistant visibility, wrapper swapping, and text-size settings.
- Keep the client name visible in the category/content context so the user can tell whose record is being edited.
- Overview is the landing category on fresh entry to Clients. Preserve drafts, search/filter values, and useful scroll positions when moving between categories and clients.
- Keep the selected category when switching brands within Clients, except when it is invalid for a non-brand scope.
- Preserve Everything and No Client navigation. Everything provides aggregate Overview/Conversations/Notes; profile editing and new records require an explicit brand. No Client continues to represent unassigned work, not a synthetic business profile or a general mailbox inbox.
- Keep legacy CRM navigation behavior on its existing surfaces; the new Clients screen should not acquire extra CRM categories merely because it shares a route family.
- Do not add a mandatory extra vertical column inside the center panel. A conversation list can transition to a thread with a clear Back control and restored list position.
- At the application's supported minimum window size, preserve usable controls and scrolling. Test with the assistant open, closed, and swapped.

### 5.2 Overview

Make the two priorities immediately visible:

1. Latest discussions: recent client threads with contact, subject, date/time, and a short actual message excerpt. Selecting one opens its thread.
2. Current work: existing active projects and open tasks, with status and relevant due dates. Selecting an item opens the existing task/project experience with the correct scope.

Below these, show pinned decisions/notes and small direct actions such as New email and Add note.

Use actual record data, not generated summaries, inferred promises, sales charts, or fabricated activity. Current work must react to changes made in Task List/Projects. Define counts using the existing task status and deletion rules. Do not count deleted tasks or duplicate parent/subtask work accidentally.

Empty states should lead to the next useful action: add a contact, connect Gmail, create a note, or open existing work. Overview must remain useful without Gmail connected.

### 5.3 Profile

Provide a compact editable brand record:

- Existing brand name and color, using the canonical client record.
- Website and short description/context.
- Contact people: name, role, email, optional phone, and primary-contact marker.
- At most one primary contact per brand; removing that contact must leave a valid state.
- Manual contact entry. No Google Contacts synchronization in this scope.

Autosave deliberate edits with a clear saving/saved/error state. Retain failed edits and support retry. Prevent a save started for one brand from being applied to the next selected brand.

Do not require optional fields to create a useful record. Validate email and website input without blocking ordinary names or legitimate international text. Basic fields are sufficient; no field-builder UI.

### 5.4 Conversations

The default list contains only conversations matched or explicitly linked to the selected brand. Include contact/date/unread filters as useful, a local text search, and the connected mailbox/status indicator.

Opening a thread shows participants, timestamps, messages, available attachments, and actions:

- New email with To, optional Cc/Bcc, subject, body, and attachments.
- Reply honoring the reply address of the message being answered.
- Reply all with visible recipients, deduplication, and exclusion of the sending account. Do not infer undisclosed Bcc recipients.
- Forward as a new outgoing conversation with quoted source content and explicitly selected attachments; do not reuse the source thread's reply headers.
- Local drafts and explicit Send. No scheduled/bulk sending or AI-generated outbound actions.

Make the current sender, recipients, and action mode clear. Opening a thread must not change Gmail's read state. Gmail archive, trash, delete, label editing, and Gmail draft synchronization are outside scope.

A manual Link conversation action can perform a bounded Gmail search for records from the connection's start date onward. It must not turn the page into a second full mailbox or persist all unrelated email. Allow correction of a mistaken link and preserve manual decisions against later automatic matching.

### 5.5 Notes

Provide internal notes for calls, meetings, decisions, and general relationship context.

- A useful minimal model is title, body, occurred-at time, optional contact, attachments, pinned state, author identity, and created/updated times.
- Reuse existing editor/composer capabilities where appropriate; avoid building a new document editor.
- Preserve drafts across navigation and restart.
- Allow edit, pin/unpin, and reversible deletion of notes.
- Visibly distinguish internal notes from outbound email; notes cannot enter a send queue.
- Pinned notes appear on Overview. No automated extraction of decisions from email.

## 6. Data and consistency requirements

The planner must select exact storage locations and migrations after inspecting current schemas. Prefer additive client-linked records in the current local persistence architecture, with one clearly owned transaction boundary. A new companion database is acceptable only with an explicit reason and a recovery plan for operations that span databases.

Specify contracts for at least:

| Concept | Required semantics |
|---|---|
| Client profile | Extension keyed by the existing client ID; no duplicate brand identity. |
| Contact | Stable ID, brand link, contact fields, primary-contact invariant, timestamps. |
| Mailbox connection | One active account, durable account identity, provider, connected-at cutoff, connection state, local secret reference only. |
| Thread/message | Account-scoped provider IDs, participant snapshots, received/sent timestamps, safe content, local read state, retention state. |
| Client-thread association | Explicit client link, automatic/manual source, ambiguity/correction handling. |
| Note | Brand link, optional contact, body, event time, author, pin and deletion state. |
| Attachment | Owning record, provider reference if applicable, safe filename, MIME type, size, local-copy state and managed storage key. |
| Draft/send attempt | Captured account/client/recipients/thread context, durable content, stable local operation ID, attempt/result state. |
| Sync checkpoint | Account/cutoff, opaque history cursor, progress/error state, idempotent recovery information. |

The final plan must settle these rules before consumers implement them:

- Treat provider IDs and Gmail history cursors as opaque strings. Do not coerce them into JavaScript numbers.
- Keep mailbox IDs in uniqueness constraints even though only one mailbox is initially supported.
- Use the existing timestamp convention deliberately; define conversion at provider boundaries and avoid inconsistent local/UTC comparisons.
- Use one local actor identity for authorship. This is preparation for later team support, not a claim that sharing is implemented.
- Store message participant snapshots so later contact edits do not rewrite history.
- A contact edit may affect future automatic matching; it must not silently move historic, explicitly linked conversations.
- Default to one deliberate client assignment per thread. If participants map to several brands, require manual resolution instead of displaying that thread under every brand.
- Match normalized exact addresses, not display names, whole domains, or guessed company names. Define conservative normalization; do not silently strip plus-addressing or dots.
- A repeated sync, restart, or retry must not duplicate messages, notes, attachments, or client associations.
- Contact removal should retain conversation history. For an existing client deletion, preserve correspondence/notes in a recoverable detached state rather than deleting evidence or resurrecting a deleted client automatically.
- Keep disconnection distinct from deletion: stop synchronization and remove only that connection's credentials while retaining local records, unless an explicit separate delete action is chosen.
- Connecting a different mailbox must never reuse the old account's cursor, drafts, provider IDs, or send state.
- Test upgrade from existing data containing clients, projects, tasks, unrelated settings, and passive CRM/Forms data.
- Do not promise recovery of an attachment never downloaded if its source message is later deleted.

Do not invent a broad backup product. Document storage/recovery behavior and extend an existing applicable backup path if inspection finds one. Migration and recovery tests must use synthetic isolated data.

## 7. Gmail architecture to plan

### 7.1 Native connection boundary

Use Google's supported desktop authorization flow through the system browser and a temporary loopback callback. Plan PKCE and state validation, cancellation, timeout, and cleanup. Google documents these desktop OAuth mechanisms in its [installed-app authorization guide](https://developers.google.com/identity/protocols/oauth2/native-app).

Keep token exchange, refresh, credential storage, and authenticated Gmail HTTP requests in the native/service boundary. The React UI should receive account metadata, sanitized domain results, and actionable errors, not tokens.

Plan for gmail.readonly plus gmail.send as the initial minimal scope set. These support reading and sending while leaving Gmail read/label state untouched. Local drafts avoid adding a Gmail draft-management requirement. Verify every selected endpoint against the [Gmail scope reference](https://developers.google.com/workspace/gmail/api/auth/scopes); do not request full mail access or gmail.modify merely for convenience.

Use the existing Windows keyring dependency through narrow new Gmail-specific operations. Do not extend the legacy AI cleanup allowlist to include Gmail, expose a generic read-any-secret command, or put refresh tokens in ordinary settings.

The app connects directly to Google. No hosted TABS backend, public callback endpoint, or browser-only production fallback is needed in this design.

### 7.2 Starting fresh and keeping up

Define a stable initial connection timestamp and history baseline. Capture new activity without a gap during initial setup. Persist the cutoff so restart, reconnect to the same account, and cursor recovery do not silently become historical imports.

Recommended behavior:

- Synchronize when the application starts, on manual refresh, and periodically while running; roughly one minute is a starting interval for this scale, not a claim of real-time delivery.
- Keep scheduling at application lifetime, independent of whether Clients is visible.
- Verify tray-hidden behavior; do not assume WebView timers remain reliable while hidden. Use the native lifecycle or another proven app-level mechanism as needed.
- Permit one synchronization job per account at a time; coalesce refresh requests.
- Fetch eligible inbound and sent mail. Match known contacts before retaining content; keep unrelated mail outside the client archive.
- When a contact is added, permit a bounded matching reconciliation since this connection's cutoff.
- Recheck after sleep/resume and recover from network outages with bounded backoff.
- Stop on actual app quit. Do not add a scheduled task or background service.

Gmail partial synchronization uses a history cursor. An expired cursor can return HTTP 404 and require reconciliation. Keep that reconciliation bounded by the chosen fresh-start window and retain existing downloaded records. Store the new checkpoint only after eligible changes are committed, and distinguish transient per-message failures from genuinely deleted messages. These provider behaviors are documented in [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync).

Old messages within a thread that receives a new message require an explicit implementation rule: retain/display post-cutoff messages by default, with a clear indication if earlier context is outside this local record. Do not pull in years of history just because a thread ID matched.

A downloaded message can remain locally readable after remote deletion. Reconciliation should update source availability, not erase the retained copy.

### 7.3 Sending and failure handling

Use valid MIME construction and base64url encoding through a suitable existing or justified library. Google describes message construction and sending in [Create and send email](https://developers.google.com/workspace/gmail/api/guides/sending).

Replies must carry the correct Gmail thread ID and RFC reply headers and follow Gmail's subject/threading requirements. Forwarding starts a separate outgoing conversation. Verify these rules against [Manage threads](https://developers.google.com/workspace/gmail/api/guides/threads).

Plan a durable send state machine, for example:

    draft -> sending -> sent
                     -> failed
                     -> outcome-unknown

- Capture account, client, recipient list, and thread identity when the user sends. A later navigation change must not change the destination.
- Prevent double-click submissions and concurrent sends of one draft.
- Keep drafts locally when offline; do not silently send them on a later restart.
- A timeout after provider submission can mean the message was accepted. Do not promise exactly-once delivery or blindly retry.
- Use a stable outgoing message identifier and reconcile against Sent where supported; otherwise surface an uncertain outcome before any deliberate retry.
- Keep a send receipt sufficient to reconcile a crash between provider success and local persistence.
- Provider errors should be clear and sanitized. Preserve draft text and selected files after failures.
- New mail, Reply all, Forward, Unicode, Cc/Bcc handling, and attachment construction all need contract and regression coverage.

### 7.4 Safe rendering and attachments

Email bodies, subjects, filenames, and quoted content are untrusted data. Use plain-text rendering or a constrained, proven sanitized HTML path. Never inject raw email HTML into the privileged Tauri page. Disable scripts/forms and automatic remote images; do not expose app IPC to message content.

Use application-managed attachment storage with generated internal keys and safe display names. Enforce filename/path handling, size limits, supported previews, and actionable errors. Never auto-execute an attachment. Handle downloads/retained files and database references as recoverable operations; a filesystem write is not atomic with a Dexie transaction.

Forwarded attachments must be selected deliberately. If a source attachment is unavailable, explain that fact and preserve the rest of the draft.

## 8. Attended preflight before autonomous implementation

This is a hard launch gate, not a late checklist. The user does not know whether their Google project is ready. The planner must make readiness work concrete and place it before the main run.

### 8.1 Resolve the bootstrap dependency

A new Gmail implementation cannot be live-verified before any code for it exists. Use a small attended preparation stage:

1. Audit the checkout, runtime, and provider setup.
2. Establish the isolated native acceptance identity and a minimal, reusable Gmail adapter/probe.
3. Complete Google setup and live verification with the owner present.
4. Freeze the proven connection contract and preflight receipt.
5. Launch the broader parallel implementation only after this gate passes.

The probe should exercise the same native authentication, credential namespace, refresh mechanism, and transport that the later implementation will use. A connector plugin, browser session, API Explorer token, or unrelated standalone script proves a different path and is insufficient by itself.

The bootstrap is limited preparation, not permission to build the entire feature before planning. A planner that is only preparing documents must describe these steps and leave their results pending; it must not fabricate receipts.

### 8.2 Provider/account readiness

During attended preflight:

- Identify the intended mailbox type: consumer Gmail or Google Workspace.
- Inspect the Google Cloud project and Gmail API enablement without exposing credential values.
- Establish a desktop OAuth client, correct consent audience, required scopes, and test-user/admin settings where applicable.
- Determine the relevant verification/exception path for this personal deployment. Do not assume that selecting personal use automatically removes all Google setup requirements. See [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
- Resolve the token lifetime relevant to the planned run. External OAuth projects in Testing can issue refresh tokens that expire after seven days when Gmail scopes are requested. A successful sign-in alone does not establish lasting unattended access. Check publishing status and applicable policy before launch, using [Google's refresh-token expiration documentation](https://developers.google.com/identity/protocols/oauth2#expiration).
- Keep secrets and authorization material in local protected storage. Store only sanitized readiness results in DOCS.
- Collect exact permitted test recipients, synthetic test content, and a bounded send count with the owner present. These are future live-test permissions, not authorization to email actual clients.
- Prepare a controlled fixture exchange with sufficient inbound, outbound, multi-recipient, and attachment examples to test new mail, Reply, Reply all, and Forward.

### 8.3 Isolated native environment

Before any launch, prove separation from the installed TABS app:

- Distinct Tauri identifier, application data directories, WebView storage/profile, Dexie origin, Gmail credential namespace, and native event journals.
- Separate process/build output and a free development port if a development server is needed.
- No collisions with the installed app's single-instance behavior, global shortcut, tray handling, file associations, or updater.
- No copying live databases, credentials, or existing profiles into DOCS or fixtures.
- No terminating the user's running TABS instance to make the test app work.

The base config currently uses com.tabs.app. The preflight must record the effective isolated identity and paths, then test those values in the actual running process. A different product title is not proof of isolation.

### 8.4 Required live proof

Execute and record actual outcomes for:

1. System-browser OAuth consent and a successful native callback.
2. Correct mailbox identity and required scopes.
3. Credential persistence across app restart in the isolated namespace.
4. A real refresh-token exchange followed by a successful API call, without another user sign-in.
5. Reading a designated synthetic inbound message and downloading its attachment.
6. Sending a designated synthetic new message and reply, verifying receipt in the controlled destination and correct reply threading.
7. Controlled Reply all and Forward cases, including the intended recipients and attachment behavior.
8. Reading through the probe without changing Gmail's read state.
9. Fresh-start cutoff and repeat-fetch deduplication on the designated fixture records.
10. The ability to complete later native regression checks with already prepared fixtures and preauthorized bounded test actions, without another planned user session.

Do not print addresses, message bodies, tokens, or raw OAuth responses into reports. Use fixture aliases, operation labels, pass/fail evidence, timestamps, hashes of non-sensitive test assets, and local references to protected private configuration.

### 8.5 Launch receipt and readiness decision

Require a structured preflight receipt containing:

    status: pending | passed | blocked
    checkedAt
    repoCandidateFingerprint
    isolatedAppIdentity
    isolationChecks
    mailboxAlias
    oauthAudienceAndPublishingState
    requiredScopesVerified
    refreshAfterRestartVerified
    credentialValidityAssessment
    liveReadSendReplyReplyAllForwardResults
    attachmentResult
    gmailReadStateUnchanged
    freshStartAndDeduplicationResult
    permittedTestSuiteReference
    adapterContractVersion
    prerequisiteFailures

Include field definitions and gate validation in the planner's output. Store no secret values or private mailbox data in this receipt. The executable launch gate must inspect actual evidence rather than trust a prose claim of success.

Run a lightweight readiness check immediately before starting the unattended phase. If preflight is incomplete, do not launch a supposedly uninterrupted run.

Even a passed preflight cannot guarantee that Google, the network, or a user/admin will never revoke access. For unexpected loss of access, retain progress and drafts, classify the external blocker, continue independent work where meaningful, and leave a precise resumable handoff. Never substitute mocked success for the missing live gate.

## 9. Parallel orchestration design

### 9.1 Team and ownership

Plan for one parent orchestrator and up to three simultaneous workers. Adapt to the execution runtime; do not claim parallel execution if delegation is unavailable. Workers should not recursively spawn more agents.

The parent owns contracts, task assignment, dependency ordering, shared-file integration, evidence, and final acceptance. Workers receive concrete bounded assignments with explicit write sets.

Default parent-owned shared files:

- App.tsx and shared workspace/header routing.
- Shared types, database schema registration, uiStore integration.
- Rust command registration and Tauri capability/configuration changes.
- package.json, package-lock.json, Cargo.toml, Cargo.lock.
- English and Turkish localization catalogs.

These files may be transferred to a single worker explicitly. Never give two workers concurrent write ownership of one file, including tests. Workers request shared changes through the parent.

Use existing task-specific orchestration documents only as examples of coordination. Their old model names, paths, runtime migrations, approvals, and feature requirements do not apply to this task.

### 9.2 Dependency structure

The planner should refine the following outline into exact work packets:

| Stage | Work | Dependencies and parallelism | Required exit |
|---|---|---|---|
| P0: discovery | Map current shell, data, native boundary, dependencies, and baseline checks. | Up to three independent read-only inventories; parent consolidates. | Accurate source map, baseline, risks, and ownership inventory. |
| P1: attended readiness | Isolated native environment, reusable Gmail probe, Google setup, live verification, prepared test suite. | After P0; owner available. Preparation work may be divided, but authentication and provider mutations have one coordinator. | Passed live preflight receipt; no unresolved predictable user action for the main run. |
| P2: contract freeze | Client/profile/contact schema, mail model, service/native contracts, sync/send state machines, migrations, acceptance matrix. | After P1; parent resolves shared decisions and independent review checks risky contracts. | Versioned contracts, dependency graph, exact writer ownership, migration fixtures. |
| P3: foundations | A: local records and persistence. B: complete native Gmail transport/auth/sync boundary. C: Clients shell/category framework and presentational primitives. | All after P2. Freeze interfaces first; parent integrates shared files. | Real foundations passing focused checks and independent review; no overlapping edits. |
| P4: feature slices | A: Profile/Notes. B: Conversations/composer/attachments. C: Overview/work links and navigation regression coverage. | Each depends on its verified P3 producers. Consumers may use fixtures during development, but exit gates require real integration. | Complete feature slices and regression evidence. |
| P5: integration and review | Combine slices; lifecycle, data integrity, error recovery, localization, accessibility, and UI refinement. | After required P4 slices. Reassign a free worker to independent review. | Stable candidate with critical findings resolved. |
| P6: final gates | Full frontend/Rust checks and isolated native end-to-end acceptance using preflight credentials and bounded test suite. | Freeze writers first; one build/test coordinator. | All required gates pass against the same final candidate. |
| P7: handoff | Changes, behavior, migrations, exact command results, native evidence, storage notes, and limitations. | After P6. | Reviewable source and verified isolated Tauri app; installed app unchanged. |

An independent reviewer should inspect authentication/isolation and persistence contracts before dependent consumers proceed, and the integrated behavior before final acceptance. Reviewers should not merely rerun their own implementation's tests.

Where a producer contract changes, notify all affected workers, version the change, update fixtures, and invalidate relevant earlier verification. Do not let parallel workers independently invent mailbox identity, client matching, attachment persistence, or send-state rules.

### 9.3 Worker prompt contract

Every worker prompt must be self-contained and include:

1. Requirement IDs and a concrete bounded outcome.
2. Repository root, relevant AGENTS.md instructions, source references, and contract version.
3. Exact files/directories it may write; shared files it must request from the parent.
4. Dependencies and which verified outputs it can rely on.
5. Positive behavior, error cases, and exclusions.
6. Tests it owns and exact validation commands.
7. The native-versus-browser evidence required.
8. A prohibition on reading/exposing live secrets or using ordinary customer email for tests.
9. Completion report fields: files changed, behavior, tests/exit codes, unresolved issues, and integration requests.
10. Handoff/resume instructions if interrupted.

Publish a compact ledger for each batch: task ID, dependencies, owner, write set, state, command results, review status, and evidence references. Distinguish implemented from verified.

### 9.4 Recovery and execution discipline

- Prefer resuming the existing checkout and ledger; do not restart the feature or replay already-present patches.
- Use bounded retries for transient operations. Escalate repeated implementation failures to the parent/reviewer with evidence.
- Classify code failures separately from external authentication/network blockers.
- Do not weaken tests, type checking, security boundaries, or capability restrictions to make gates pass.
- One coordinator owns native builds and shared output paths. Run final checks only after relevant writers stop.
- Stop only task-owned processes during test cleanup; leave the user's installed app and other servers alone.
- No blanket cleanup of directories, caches, keyrings, or build outputs.

## 10. Acceptance matrix the final plan must expand

Each requirement must map to work packets, tests, an acceptance action, and an evidence location.

| ID | Required behavior | Minimum evidence |
|---|---|---|
| CL-01 | Fifth Clients header tab; correct active state and navigation between all existing tabs. | Header/routing tests and isolated native interaction. |
| CL-02 | Existing far-left client navigation preserved; category panel occupies Task List's corresponding position. | Layout tests and native checks at normal/minimum sizes. |
| CL-03 | Existing client IDs, creation behavior, projects, and tasks remain consistent. | Store/migration fixtures and cross-tab acceptance. |
| CL-04 | Overview shows actual latest discussion and current work, with correct links. | Selector tests and native record/task updates. |
| CL-05 | Brand/contact editing, primary contact, autosave errors, and brand switching work correctly. | Persistence and UI regression tests. |
| CL-06 | Internal notes support editing, pinning, attachments, retention, and distinct internal labeling. | Store/UI tests and native restart check. |
| GM-01 | Live desktop OAuth, account identity, secure persistence, and refresh verified before main launch. | Passed attended preflight receipt. |
| GM-02 | One mailbox; fresh-start cutoff; inbound and sent matching; manual correction and ambiguity handling. | Fixtures plus preauthorized live/native checks. |
| GM-03 | New, Reply, Reply all, Forward, recipients, threading, and attachments function correctly. | MIME/address unit tests and controlled live exchange. |
| GM-04 | Local read state never changes Gmail read state. | Scope/API contract tests and live before/after check on fixture message. |
| GM-05 | Sync survives navigation, tray hide, restart, sleep/network recovery, and expired cursor. | Failure-injection tests and native lifecycle acceptance. |
| GM-06 | Repeated sync and uncertain send outcomes do not cause blind duplicate sends or lost drafts. | Crash/retry tests and state-machine review. |
| GM-07 | Downloaded records persist after provider deletion; missing undownloaded attachments are explained. | Synthetic deletion fixtures and local persistence tests. |
| GM-08 | Unsafe HTML, remote images, malicious filenames, and unsupported attachments stay contained. | Rendering/storage tests and native review. |
| UX-01 | Keyboard/focus behavior, empty/error/loading states, scrolling, text sizing, and EN/TR copy are usable. | UI tests and focused native QA. |
| RG-01 | Docs, Task List, Calendar, Projects, passive CRM/Forms, Settings, Terminal, and assistant remain functional. | Existing suite plus targeted native regression checks. |
| RG-02 | No new mail/notes content enters AI context automatically; no WhatsApp/team/server feature is introduced. | Call-site review and targeted contract tests. |
| OP-01 | Production storage, credentials, processes, and installed app are untouched. | Isolation/path/process evidence and final diff review. |
| OP-02 | Final deliverable is tested source and an isolated native app, without packaging or installation. | Final gate report with exact executable/config identity. |

Test realistic data first, then a modest larger synthetic fixture to verify pagination, search, and scrolling. This scale does not justify a search server or enterprise CRM infrastructure.

## 11. Verification commands and evidence boundaries

Required frontend gate from the repository root:

~~~powershell
npm run check
~~~

For Rust/Tauri changes, from src-tauri:

~~~powershell
cargo fmt --check
cargo check
~~~

Add meaningful targeted Rust tests for the new native logic, using isolated credentials/storage fixtures. The planner must specify the exact test commands after selecting modules.

For native acceptance, the installed CLI supports a non-bundled build with a separate config:

~~~powershell
npm run tauri -- build --no-bundle --config <isolated-config-path>
~~~

The planner must replace the configuration placeholder with a real prepared path and verify effective identity/data directories before launching the executable. Coordinate target/output directories to avoid collisions with any running build.

Do not use npm run tauri:build as an installer-producing acceptance shortcut. Do not run an installer or replace the installed executable. The selected completion level is source plus an isolated native application.

Distinguish:

1. Source/type/lint/unit evidence.
2. Browser/Vite preview evidence.
3. Native compile/build evidence.
4. Actual isolated Tauri UI and runtime evidence.
5. Live Gmail/provider evidence.

Passing one layer does not substitute for another. Final native acceptance must exercise the completed application, not only the preflight probe. Keep credentials and the preauthorized synthetic test suite usable from preflight through final acceptance to avoid planned owner interruptions.

A pre-existing failure must be recorded exactly. Do not call the final gate passed if it did not pass, or silently expand scope to fix unrelated issues. If a prerequisite genuinely blocks the selected completion standard, record it before launch or report it as a real remaining blocker.

## 12. What the receiving planner must deliver

Produce a coherent package in this topic folder, without starting the implementation run merely because the plan exists:

1. Implementation plan: ordered phases, explicit dependencies, exact scope, decisions, and exit criteria.
2. Attended preflight instructions: Google setup discovery, isolated native bootstrap, live tests, test-recipient permissions, receipt schema, and executable launch checks.
3. Contract document: schema ownership, IDs, matching, sync cutoffs/checkpoints, send state machine, attachment lifecycle, UI/service/native boundaries, and error contracts.
4. Work packets and worker prompts: exclusive file ownership, dependencies, tests, outputs, and review assignments.
5. Acceptance matrix: requirement-to-test mapping and actual native/live evidence requirements.
6. Execution/resume ledger template: states, candidate/contract versions, current owner, command results, review findings, and external blockers.
7. Orchestrator launch prompt: copy-ready instructions that consume the package after preflight, respect authorization limits, and continue through completion level A.

The planner may consolidate documents where that improves usability; keep one clear entry point and relative links. Do not create a VPS/Hermes plan package or invoke a publishing workflow for this local task.

Every planned implementation packet should state:

    ID and title
    Requirement IDs
    Needs
    Owner/role and concurrency constraints
    Files to inspect
    Exclusive write set
    Contract inputs and outputs
    Implementation steps
    Focused tests
    Integration and review gate
    Failure/recovery behavior
    Completion evidence

The plan should be detailed enough that an orchestrator can assign independent work without guessing data contracts, silently changing product scope, or discovering Google sign-in requirements halfway through the run.

## 13. Final handoff expected from implementation

Require a concise report containing:

- Feature behavior and source files changed.
- Migration/storage/retention notes, including what remains local after Gmail disconnection or deletion.
- Exact commands, exit codes, test totals, and existing warnings.
- The isolated application's actual executable/configuration identity and native acceptance results.
- Sanitized live Gmail evidence linked to the preflight receipt and final candidate.
- Confirmation that no installer was produced or installed and the user's installed app was not changed.
- Remaining limitations, including one mailbox, no WhatsApp, no team sharing, and no new email/notes AI features.
- Any external blocker honestly separated from verified implementation work.

Do not label a mocked connection, browser preview, compile-only executable, or partially completed live test as acceptance.
