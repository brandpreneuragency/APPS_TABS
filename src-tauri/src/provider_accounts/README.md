# Isolated Codex account backend

This module owns monitoring/login only. It never starts a thread/turn, redeems a
reset credit, selects an AI Chat account, reads the native Codex home, or imports
another application's credentials.

## Tauri integration

1. Add `mod provider_accounts;` in `src-tauri/src/lib.rs`.
2. Change only the visibility of `codex::discovery` to `pub(crate) mod discovery;`.
   The existing `codex::CliOwnedJob` re-export already provides process ownership.
   **Do not change the chat-specific supported-version pin.** This module uses
   the discovered native launch regardless of `Discovery.supported` and performs
   its own initialize/account handshake.
3. Register these commands in the existing Tauri invoke handler:
   - `provider_accounts::provider_accounts_list`
   - `provider_accounts::provider_accounts_refresh`
   - `provider_accounts::provider_accounts_begin_login`
   - `provider_accounts::provider_accounts_poll_login`
   - `provider_accounts::provider_accounts_cancel_login`
   - `provider_accounts::provider_accounts_open_login`
4. No `.manage(...)` state registration, new dependency or broad shell/opener
   permission is required. The process-local registry is keyed by canonical app
   data path. All commands are async and move blocking work off the UI thread.

Arguments are `accountId` and `loginId` on the JavaScript boundary; refresh's
`accountId` is nullable. Struct fields serialize camelCase. Times are epoch
milliseconds. Every command also takes the injected WebviewWindow and rejects
windows other than `main`. Login URL is returned only by `begin_login`, validated
against the exact HTTPS `auth.openai.com` authority, never persisted or logged.
The opener accepts only the active account/login IDs and retrieves their cached
URL; it never accepts a renderer-supplied URL. Windows ShellExecuteW opens that
URL directly without a shell command. Only its existing windows-sys compile
features are enabled; no Tauri shell/file permission is broadened. UI code must
not log the authorization URL.

`poll_login.status=completed` means authentication completed. A quota read can
still fail: inspect the returned account's `status`/`error`. `pending` has a null
account. Terminal results are repeatable until a new login replaces that slot.
Old login IDs never cancel, poll or publish into the replacement login. Manual
refresh skips a slot with a pending unexpired login. A ten-minute watchdog kills
abandoned login processes even when the frontend stops polling. RPCs have finite
twenty-second deadlines; process trees use kill-on-close Windows Job Objects.
The supported browser flow owns a local callback listener, so different account
slots are linked sequentially. Starting another slot's login while one is pending
is refused before changing that slot's metadata. Replacing the same slot still
invalidates its old login ID and old quota.

## Local state and identity

- Sanitized snapshots: `<app_data_dir>/provider-accounts/codex/accounts.json`.
- Isolated homes: `<app_data_dir>/provider-accounts/codex/codex-1` through
  `codex-4`, selected by exact slot allowlist, never a frontend-supplied path.
- Snapshot writes are serialized, staged, synced, atomically replaced, and refuse
  to overwrite parse corruption. Symlinks/reparse points are rejected.
- Child environment is allowlisted and home/config/temp directories are private
  to that slot. No inherited API keys, proxy overrides or provider settings.
- Auth uses Codex's `cli_auth_credentials_store="keyring"`, forced ChatGPT login,
  and `features.secret_auth_storage=false` (direct keyring backend). It never
  falls back to the user's native home or a plaintext credential file.
- Identity reads **only** the exact slot's direct Codex keyring entry. Its naming
  is established by the official 0.159.2 source:
  `codex-rs/login/src/auth/storage.rs` (`Codex Auth`,
  `cli|` + first 16 SHA256 hex characters of canonical `CODEX_HOME`), and
  `codex-rs/core/src/config/auth_keyring.rs`.
- Principal/workspace metadata comes from that entry's ID-token claims, checked
  against account/read workspace routing and token account ID. This is local
  identity attribution, not independent JWT signature verification or an auth
  token usable by the frontend. Only a composite SHA256 key, email, workspace ID
  and plan leave the parser. Raw auth material is never serialized to snapshots.
- If identity cannot be obtained/matched, it remains null and quota is withheld;
  email alone is never used as an identity. Changed identities clear old usage.
- Last-good usage survives read errors for the same identity. Five-hour/weekly
  windows are chosen by duration, not array position. Reset tokens use only
  `rateLimitResetCredits.availableCount`, never detail-row count. Missing values
  stay null. No clock-based recovery inference or credit-redemption call exists.

## Tests

Unit tests live beside implementation. `test_fixture.rs` is a **network-free,
synthetic** app-server executable, not part of the production module. Build it
as a scratch harness binary (`[[bin]]` with `path` pointing to that file); export
`TABS_PROVIDER_TEST_FIXTURE` to the resulting absolute executable path when
running the two ignored `synthetic_` lifecycle/watchdog tests.

The ignored `installed_` tests use a fresh empty scratch home and the installed
CLI to verify initialize, signed-out account/read, rateLimits rejection, native
Store refresh/persistence and process cleanup. They never start a login or run
inference. Do not run real owner-account acceptance without separate approval.
Tests prefer `TMPDIR` for fixture data, falling back to normal OS temp only when
not running under the agent's explicit scratch environment.

Before parent integration, the scratch crate can compile the actual module via
`#[path = ".../provider_accounts/mod.rs"]`, and expose the existing codex
`protocol.rs`, `process.rs`, and `discovery.rs` under a small harness `mod codex`.
No alternate implementation is used. After integration use normal repository
`cargo check`, `cargo fmt --check`, and focused `cargo test provider_accounts::`.
