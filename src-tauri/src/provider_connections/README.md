# Read-only consumer observations

This independent module observes **stored configuration**, never proves a live
request's account, never logs in, refreshes tokens, switches accounts, or invokes
an application's auth/status APIs. There is no cache and no last-good fallback.

## Integration (parent-owned)

Declare `mod provider_connections;` in the crate root and register
`provider_connections::provider_connections_refresh` in Tauri's command handler.
The async command accepts only injected `WebviewWindow`, rejects windows other
than `main`, and returns the four camelCase `ConsumerObservation` records.
It does not accept paths, hosts, commands, token material or SSH arguments.
No Cargo dependency changes are required.

## Boundaries

- `mod.rs`: fixed interpreter/SSH discovery and invocation, owned child cleanup,
  24-second per-child deadline, 16 KiB stdout limit, discarded stderr, strict
  typed JSON with unknown-property rejection, finite IDs/evidence/reason codes.
  Failed probes return fresh unavailable records (null identity/timestamp), not
  a prior successful identity. A refresh is sequential and bounded to about
  48 seconds plus process startup/cleanup; SSH's remote process has an additional
  18-second timeout covering both resolver and collector.
- Local interpreter discovery checks existing native Python installation paths
  and standalone Python directories under `LOCALAPPDATA/hermes/tools`. It never
  executes project/PATH aliases, installs Python, imports Hermes or loads a pool.
  Python runs `-I -B -` with only the embedded collector on stdin.
- SSH is pinned to the OS OpenSSH binary and `admin@atlas-vps`, BatchMode,
  connection/alive deadlines, no local command, proxy command, jump or forwards.
  Each invocation first checks atlas-map resolver success, evaluates its trusted
  exports and requires an existing `HERMES_DIR`. Only then it executes fixed
  `python3 -I -B - --remote` with the collector on stdin. No remote files are
  installed, and no task-authority command or general RPC is reused.
- Native auth reads are limited to local `LOCALAPPDATA/hermes/auth.json`, remote
  resolved `HERMES_DIR/auth.json`, and each native user's
  `HOME/.local/share/opencode/{opencode.db,auth.json}`. No credential-store or
  unrelated application discovery, HTTP credential endpoints, BRAIN or VAULT.
- JWT payloads from the exact application's access/id token fields are decoded
  only in process memory. Only allowlisted identity fields leave Python. Claims
  are **unverified stored metadata**, not token-validity or session evidence.
  Email is display-only. The stable key is SHA256 of compact UTF-8 JSON
  `["openai-codex", principal, workspace]`, with the principal taken only from
  nested OpenAI auth `chatgpt_user_id`/`user_id`, and workspace from its account
  claim or checked explicit account metadata. Conflicting principal/workspace
  claims drop identity. Missing claims never turn email into an identity key.

## Selection and uncertainty

Hermes considers both its Codex provider singleton and pool candidates. Equal
known stable identities collapse; conflicting identities or unknown candidates
alongside other candidates yield `multipleConfiguredAccounts`, without choosing
by priority or process presence. A singleton without decodable identity remains
configured/`identityUnavailable`.

OpenCode V2 inspects only `integration_id='openai'` in the credential table,
using SQLite URI `mode=ro`, `PRAGMA query_only=ON`, a progress deadline, and an
explicit allowlisted metadata query. Exactly one `active=1` row is the **stored
default**, not runtime proof. Only its value is parsed internally for identity.
An existing V2 database, including empty/corrupt/unsupported state, never falls
back to stale V1 credentials. V1 `auth.json` is consulted only without V2 DB.
API-key auth is not a Codex subscription-account binding.

A live OpenCode process without independently established runtime version/store
returns `runtimeStoreAmbiguous` before reading either default store. Windows
uses stdlib ctypes Toolhelp name matching; Linux checks `/proc/*/comm` only for
the fixed OpenCode name. No command lines or process-environment values are
printed or decoded. Presence never raises evidence to runtime. Failure to inspect
process state is uncertainty. `OPENCODE_AUTH_CONTENT`/`OPENCODE_TEST_HOME`
presence in the collector environment returns `sourceUnavailable`; their values
are not read. This adapter deliberately does not infer that a deleted VPS V1
executable uses the V2 DB merely because a newer executable/database exists.

## Verification

Fixture command from repository root:

```sh
python -I -B src-tauri/src/provider_connections/test_collector.py -v
rustfmt --edition 2021 --check src-tauri/src/provider_connections/mod.rs
```

Run registered Rust tests after integration with
`cargo test --lib provider_connections::tests` from `src-tauri`.
The explicitly ignored `provider_connections::tests::live_read_smoke` performs
real fixed-scope native/SSH reads and emits **only sanitized records**; run it
only when live reads are authorized:

```sh
cargo test --lib provider_connections::tests::live_read_smoke -- --ignored --nocapture
```

Verification performed in this delegated implementation:

- Python: 12 isolated fixture tests passed (synthetic JWTs and SQLite only).
  Covers native-compatible identity hashing, conflicts, unknown/malformed pool
  candidates, V1/V2 precedence, active default selection, missing/corrupt stores,
  sanitized output, unavailable runtime/override states, failure isolation and
  byte/mtime/directory equality across a read-only SQLite observation.
- Rust: four parser fixture tests passed in a scratch Cargo harness importing
  this module with existing serde/serde_json/Tauri dependencies. Includes unknown
  token properties at both levels, malicious value shape, wrong location,
  duplicate location, oversized stdout, free-form error and runtime rejection.
  Cargo compilation passed; no repository Cargo or crate-root edits were made.
- Explicit native live smoke passed through the **actual Rust transport**:
  MOTHER Hermes and ATLAS Hermes returned the same configured stable identity;
  MOTHER OpenCode returned a different configured stable identity from V2;
  VPS OpenCode returned unavailable/`runtimeStoreAmbiguous`. All configured
  results remained `runtimeUnverified`. Owner identity details are deliberately
  not copied into source documentation.
- This is focused fixture verification, not a claim of full Strict TDD: the
  initial missing collector produced the observed RED, while broader fixture
  coverage was added after the implementation. The automatic file-write Rust
  linter defaults to Rust 2015 and incorrectly flags async syntax; explicit
  edition-2021 rustfmt and Cargo compilation are the relevant checks.

Not verified here: parent command registration/capability integration, packaged
Tauri UI, four-account login, quota APIs, per-request runtime account identity,
or a private OpenCode Plus/T3 fork. These are not implied by this adapter.
