# Provider accounts: module boundaries

This feature monitors provider accounts. It is intentionally not another chat
runtime, remote-session service, task authority, or global credential pool.

## Ownership

- `types.ts`: small shared account identity, usage snapshot and consumer evidence
  contract. Managed account IDs are local references, not email addresses or
  credential paths. A null observation identity key means matching is unavailable.
- `desktopClient.ts`: the only frontend Tauri door for this module. It accepts
  account/login IDs, never tokens, hosts, file paths, arbitrary RPC methods or
  commands.
- `model.ts`: pure presentation rules. Missing quota is unknown; reset timestamps
  do not prove a refill. Account bindings require the provider plus the composite
  principal/workspace key, never email equality.
- `store.ts`: transient UI state and async ownership. Native storage owns durable
  accounts/snapshots; no second auth/persistence copy in Zustand, Dexie or browser
  localStorage. Cancellation and a replacement login invalidate late responses.
- `src-tauri/src/provider_accounts/`: Codex-owned isolated login homes, supported
  account protocol, safe local snapshots and supervised process lifecycle.
- `src-tauri/src/provider_connections/`: independent read-only observations of
  the four approved application locations. Stored/configured identities never
  become runtime-confirmed merely because an application process exists.
- `src/components/providerAccounts/`: display and explicit owner actions only.

The existing `services/codex`, `services/providers` and chat stores retain their
current ownership. Opening this dashboard, refreshing quotas, or connecting a
monitoring account does not switch their accounts, run a model, redeem resets or
change another application's login.

## Adding another provider

1. Verify its supported authentication and account-usage surface. A subscription,
   an API cash balance and a model's per-window quota are different metrics.
2. Add a provider-specific native collector behind the same sanitized account
   contract. Keep its token lifecycle and parsing separate from Codex and from
   consumer observations. Do not expand this command surface into arbitrary HTTP,
   shell, credential lookup or remote RPC.
3. Describe actual capabilities in `ACCOUNT_PROVIDERS`; do not manufacture missing
   windows or a currency value. Extend metrics explicitly when needed.
4. Add narrow normalization, missing-data, account-isolation and failure tests.
   Exercise the real supported adapter with isolated fixtures before owner login.

## Later AI Chat integration

Account discovery/auth metadata can be shared; quota monitoring and chat execution
remain separate adapters. A future chat connection must explicitly select a local
`accountId` and bind it to the conversation/run lifetime. Refreshing a dashboard
or changing a global default must not silently retarget an existing conversation.
A provider being monitorable does not prove its subscription is usable by the
existing chat transport; verify that execution/billing route separately.

## Verification limits

Browser preview can verify navigation/rendering only; native credentials remain
unavailable there. Owner-completed login and authenticated quota reads are a
separate acceptance step. The current connection collectors prove configured
identity only. Actual per-request identity requires a supported runtime signal;
unknown evidence must stay unknown until that signal exists.

Workstream and exact current checks: `docs/work/provider-accounts.md`.
