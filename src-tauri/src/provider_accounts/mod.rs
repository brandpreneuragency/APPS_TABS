//! Isolated provider-account monitoring, deliberately separate from AI Chat.
//! Integration: `mod provider_accounts;` and register the five command exports.
//! No Tauri managed state is required: a process-local registry is keyed by the
//! canonical app data directory. Parent must expose codex::discovery pub(crate);
//! codex::CliOwnedJob is the existing process-tree ownership re-export.
mod browser;
mod client;
mod model;
mod storage;

pub use model::{AccountStatus, ProviderAccount};

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};

use client::Client;
use model::{
    apply_identity, initial_accounts, mark_duplicates, mark_error, parse_usage, slot_index,
};

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStart {
    pub account_id: String,
    pub login_id: String,
    pub auth_url: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LoginStatus {
    Pending,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginPoll {
    pub status: LoginStatus,
    pub account: Option<ProviderAccount>,
    pub error: Option<String>,
}

struct Login {
    id: String,
    auth_url: String,
    started: Instant,
    client: Client,
}
#[derive(Default)]
struct Slot {
    login: Option<Login>,
    terminal: Option<(String, LoginPoll)>,
}

struct Store {
    root: PathBuf,
    accounts: Mutex<Vec<ProviderAccount>>,
    slots: Vec<Mutex<Slot>>,
    login_start: Mutex<()>,
    #[cfg(test)]
    fixture_executable: Option<PathBuf>,
}

static STORES: OnceLock<Mutex<HashMap<PathBuf, Arc<Store>>>> = OnceLock::new();

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

impl Store {
    fn new(root: PathBuf) -> Result<Self> {
        let mut accounts = storage::load(&root)?;
        mark_duplicates(&mut accounts);
        Ok(Self {
            root,
            accounts: Mutex::new(accounts),
            login_start: Mutex::new(()),
            #[cfg(test)]
            fixture_executable: None,
            slots: initial_accounts()
                .iter()
                .map(|_| Mutex::new(Slot::default()))
                .collect(),
        })
    }
    fn start_client(&self, index: usize) -> Result<Client> {
        let home = self.home(index)?;
        #[cfg(test)]
        if let Some(executable) = &self.fixture_executable {
            return Client::start_fixture(&home, executable);
        }
        Client::start(&home)
    }
    fn home(&self, index: usize) -> Result<PathBuf> {
        storage::directory(&self.root, &initial_accounts()[index].id)
    }
    fn list(&self) -> Result<Vec<ProviderAccount>> {
        // Also detect external corruption instead of silently keeping a healthy
        // in-memory cache and later overwriting the owner's recovery evidence.
        let _ = storage::load(&self.root)?;
        Ok(self
            .accounts
            .lock()
            .map_err(|_| "Provider metadata lock failed")?
            .clone())
    }
    fn update(
        &self,
        index: usize,
        change: impl FnOnce(&mut ProviderAccount),
    ) -> Result<ProviderAccount> {
        let mut accounts = self
            .accounts
            .lock()
            .map_err(|_| "Provider metadata lock failed")?;
        let mut next = accounts.clone();
        change(&mut next[index]);
        mark_duplicates(&mut next);
        storage::save(&self.root, &next)?;
        *accounts = next;
        Ok(accounts[index].clone())
    }
    fn fail(&self, index: usize, message: &str) -> Result<ProviderAccount> {
        self.update(index, |a| mark_error(a, now(), message))
    }

    /// The caller holds the slot mutex from before process creation through final
    /// publication. Replacement login, cancellation, polling and refresh serialize
    /// here; no previous client's response can write into a replacement account.
    fn observe(&self, index: usize, client: &mut Client) -> Result<ProviderAccount> {
        let home = self.home(index)?;
        self.update(index, |a| a.last_attempt_at = Some(now()))?;
        let account = match client.read_account() {
            Ok(a) => a,
            Err(e) => return self.fail(index, &e),
        };
        let Some(info) = account.get("account").filter(|v| !v.is_null()) else {
            return self.update(index, |a| {
                apply_identity(a, None);
                a.status = AccountStatus::AuthRequired;
                a.error = None;
            });
        };
        if info.get("type").and_then(Value::as_str) != Some("chatgpt") {
            return self.update(index, |a| {
                apply_identity(a, None);
                a.status = AccountStatus::AuthRequired;
                a.error = Some("This slot requires ChatGPT login, not an API key".into());
            });
        }
        let identity = client::read_identity(&home, &account);
        self.update(index, |a| apply_identity(a, identity.clone()))?;
        let Some(identity) = identity else {
            return self.fail(index,"Authenticated account identity is unavailable; quota is withheld to prevent cross-account attribution");
        };
        let limits = match client.read_limits() {
            Ok(l) => l,
            Err(e) => return self.fail(index, &e),
        };
        // Verify both the authenticated principal/workspace and any backend
        // snapshot accountId after the fetch. Email alone is never ownership.
        let after = match client.read_account() {
            Ok(a) => a,
            Err(e) => return self.fail(index, &e),
        };
        let current = client::read_identity(&home, &after);
        let mismatched = limits
            .get("accountId")
            .and_then(Value::as_str)
            .is_some_and(|id| Some(id) != identity.workspace_id.as_deref());
        if mismatched || current.as_ref().map(|i| &i.key) != Some(&identity.key) {
            return self.update(index, |a| {
                apply_identity(a, current);
                a.usage = None;
                a.last_success_at = None;
                mark_error(
                    a,
                    now(),
                    "Account changed during quota refresh; snapshot discarded",
                );
            });
        }
        let usage = match parse_usage(&limits) {
            Ok(u) => u,
            Err(e) => return self.fail(index, &e),
        };
        self.update(index, |a| {
            a.identity = Some(identity);
            a.usage = Some(usage);
            a.status = AccountStatus::Connected;
            a.error = None;
            a.last_success_at = Some(now());
        })
    }

    fn refresh(&self, id: Option<&str>) -> Result<Vec<ProviderAccount>> {
        let indices = match id {
            Some(id) => vec![slot_index(id)?],
            None => (0..self.slots.len()).collect(),
        };
        for index in indices {
            let mut slot = self.slots[index]
                .lock()
                .map_err(|_| "Provider slot lock failed")?;
            if let Some(login) = &slot.login {
                if login.started.elapsed() < client::LOGIN_LIFETIME {
                    continue;
                }
                slot.login.take();
                self.fail(index, "Codex login expired")?;
            }
            self.update(index, |a| a.last_attempt_at = Some(now()))?;
            match self.start_client(index) {
                Ok(mut client) => {
                    self.observe(index, &mut client)?;
                }
                Err(e) => {
                    self.fail(index, &e)?;
                }
            }
        }
        self.list()
    }

    fn begin(&self, id: &str) -> Result<LoginStart> {
        let index = slot_index(id)?;
        // The supported browser flow owns one local callback listener. Link the
        // slots sequentially rather than racing account logins on the same port.
        let _start = self
            .login_start
            .lock()
            .map_err(|_| "Provider login lock failed")?;
        for (other, slot) in self.slots.iter().enumerate() {
            if other == index {
                continue;
            }
            let slot = slot.lock().map_err(|_| "Provider slot lock failed")?;
            if slot
                .login
                .as_ref()
                .is_some_and(|login| login.started.elapsed() < client::LOGIN_LIFETIME)
            {
                return Err("Finish or cancel the other account sign-in first".into());
            }
        }
        let mut slot = self.slots[index]
            .lock()
            .map_err(|_| "Provider slot lock failed")?;
        // Drop terminates and joins the old process tree before replacement.
        if let Some(mut old) = slot.login.take() {
            let _ = old.client.cancel_login(&old.id);
        }
        slot.terminal = None;
        // Clear before any network work; old quotas must never appear as a new
        // login's quota, even if initialization/start subsequently fails.
        self.update(index, |a| {
            apply_identity(a, None);
            a.status = AccountStatus::AuthRequired;
            a.error = None;
            a.last_attempt_at = Some(now());
        })?;
        let attempt: Result<LoginStart> = (|| {
            let mut client = self.start_client(index)?;
            let (login_id, auth_url) = client.begin_login()?;
            slot.login = Some(Login {
                id: login_id.clone(),
                auth_url: auth_url.clone(),
                started: Instant::now(),
                client,
            });
            Ok(LoginStart {
                account_id: id.into(),
                login_id,
                auth_url,
            })
        })();
        if let Err(e) = &attempt {
            self.fail(index, e)?;
        }
        attempt
    }

    fn poll(&self, id: &str, login_id: &str) -> Result<LoginPoll> {
        let index = slot_index(id)?;
        let mut slot = self.slots[index]
            .lock()
            .map_err(|_| "Provider slot lock failed")?;
        if let Some((completed, poll)) = &slot.terminal {
            if completed == login_id {
                return Ok(poll.clone());
            }
        }
        let login = slot
            .login
            .as_mut()
            .filter(|l| l.id == login_id)
            .ok_or("Login is no longer active for this slot")?;
        let completion = if login.started.elapsed() >= client::LOGIN_LIFETIME {
            Err("Codex login expired".into())
        } else {
            login.client.login_completion(login_id)
        };
        let result = match completion {
            Ok(None) => {
                return Ok(LoginPoll {
                    status: LoginStatus::Pending,
                    account: None,
                    error: None,
                })
            }
            Ok(Some(true)) => {
                let account = self.observe(index, &mut login.client)?;
                // Authentication can complete successfully even when quota read
                // failed. The account exposes that independent observation error.
                if matches!(
                    account.status,
                    AccountStatus::AuthRequired | AccountStatus::Disconnected
                ) {
                    LoginPoll {
                        status: LoginStatus::Failed,
                        error: Some("Login completed without a ChatGPT account".into()),
                        account: Some(account),
                    }
                } else {
                    LoginPoll {
                        status: LoginStatus::Completed,
                        error: account.error.clone(),
                        account: Some(account),
                    }
                }
            }
            Ok(Some(false)) => LoginPoll {
                status: LoginStatus::Failed,
                account: Some(self.fail(index, "Codex login failed")?),
                error: Some("Codex login failed".into()),
            },
            Err(e) => LoginPoll {
                status: LoginStatus::Failed,
                account: Some(self.fail(index, &e)?),
                error: Some(e),
            },
        };
        slot.login.take();
        slot.terminal = Some((login_id.into(), result.clone()));
        Ok(result)
    }

    fn login_url(&self, id: &str, login_id: &str) -> Result<String> {
        let index = slot_index(id)?;
        let slot = self.slots[index]
            .lock()
            .map_err(|_| "Provider slot lock failed")?;
        let login = slot
            .login
            .as_ref()
            .filter(|login| {
                login.id == login_id && login.started.elapsed() < client::LOGIN_LIFETIME
            })
            .ok_or("Login is no longer active for this slot")?;
        Ok(login.auth_url.clone())
    }

    fn cancel(&self, id: &str, login_id: &str) -> Result<()> {
        let index = slot_index(id)?;
        let mut slot = self.slots[index]
            .lock()
            .map_err(|_| "Provider slot lock failed")?;
        if slot
            .terminal
            .as_ref()
            .is_some_and(|(completed, _)| completed == login_id)
        {
            return Ok(());
        }
        if !slot.login.as_ref().is_some_and(|l| l.id == login_id) {
            return Err("Login is no longer active for this slot".into());
        }
        let mut login = slot.login.take().unwrap();
        let cancelled = login.client.cancel_login(login_id);
        drop(login); // also kill on protocol error/timeout; never leave callback listener alive
        let account = self.update(index, |a| {
            a.status = AccountStatus::AuthRequired;
            a.error = None;
        })?;
        slot.terminal = Some((
            login_id.into(),
            LoginPoll {
                status: LoginStatus::Failed,
                account: Some(account),
                error: Some("Login cancelled".into()),
            },
        ));
        cancelled
    }
}

fn store_for(app: &AppHandle) -> Result<Arc<Store>> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| "Application data directory is unavailable")?;
    storage::reject_link(&base)?;
    std::fs::create_dir_all(&base).map_err(|_| "Could not create application data directory")?;
    let root = storage::directory(&storage::directory(&base, "provider-accounts")?, "codex")?;
    let mut registry = STORES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Provider registry lock failed")?;
    if let Some(store) = registry.get(&root) {
        return Ok(store.clone());
    }
    let store = Arc::new(Store::new(root.clone())?);
    registry.insert(root, store.clone());
    Ok(store)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "Provider account operation did not finish")?
}

fn require_main(window: &WebviewWindow) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Provider accounts require the main TABS window".into())
    }
}

#[tauri::command]
pub async fn provider_accounts_list(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<ProviderAccount>> {
    require_main(&window)?;
    blocking(move || store_for(&app)?.list()).await
}
#[tauri::command]
pub async fn provider_accounts_refresh(
    app: AppHandle,
    window: WebviewWindow,
    account_id: Option<String>,
) -> Result<Vec<ProviderAccount>> {
    require_main(&window)?;
    blocking(move || store_for(&app)?.refresh(account_id.as_deref())).await
}
#[tauri::command]
pub async fn provider_accounts_begin_login(
    app: AppHandle,
    window: WebviewWindow,
    account_id: String,
) -> Result<LoginStart> {
    require_main(&window)?;
    blocking(move || store_for(&app)?.begin(&account_id)).await
}
#[tauri::command]
pub async fn provider_accounts_poll_login(
    app: AppHandle,
    window: WebviewWindow,
    account_id: String,
    login_id: String,
) -> Result<LoginPoll> {
    require_main(&window)?;
    blocking(move || store_for(&app)?.poll(&account_id, &login_id)).await
}
#[tauri::command]
pub async fn provider_accounts_cancel_login(
    app: AppHandle,
    window: WebviewWindow,
    account_id: String,
    login_id: String,
) -> Result<()> {
    require_main(&window)?;
    blocking(move || store_for(&app)?.cancel(&account_id, &login_id)).await
}

#[tauri::command]
pub async fn provider_accounts_open_login(
    app: AppHandle,
    window: WebviewWindow,
    account_id: String,
    login_id: String,
) -> Result<()> {
    require_main(&window)?;
    blocking(move || browser::open(&store_for(&app)?.login_url(&account_id, &login_id)?)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Store) {
        let dir = tempfile::Builder::new()
            .prefix("tabs-provider-store-")
            .tempdir_in(storage::test_temp_root())
            .unwrap();
        let store = Store::new(dir.path().canonicalize().unwrap()).unwrap();
        (dir, store)
    }
    #[test]
    fn stale_login_and_unknown_slots_cannot_change_snapshots() {
        let (_dir, store) = fixture();
        let before = store.list().unwrap();
        assert!(store.poll("codex-1", "old-login").is_err());
        assert!(store.cancel("codex-1", "old-login").is_err());
        assert!(store.begin("../escape").is_err());
        assert!(store.refresh(Some("codex-5")).is_err());
        assert_eq!(store.list().unwrap(), before);
    }
    #[test]
    fn concurrent_slot_updates_preserve_all_snapshots() {
        let (_dir, store) = fixture();
        std::thread::scope(|scope| {
            for i in 0..4 {
                let store = &store;
                scope.spawn(move || {
                    for attempt in 0..8 {
                        store
                            .update(i, |a| a.last_attempt_at = Some(attempt))
                            .unwrap();
                    }
                });
            }
        });
        let restored = storage::load(&store.root).unwrap();
        assert_eq!(restored, store.list().unwrap());
        assert!(restored.iter().all(|a| a.last_attempt_at == Some(7)));
    }
    #[test]
    #[ignore = "Requires explicitly built network-free TABS_PROVIDER_TEST_FIXTURE binary"]
    fn synthetic_login_lifecycle_and_stale_ownership() {
        let (_dir, mut store) = fixture();
        store.fixture_executable = Some(PathBuf::from(
            std::env::var_os("TABS_PROVIDER_TEST_FIXTURE")
                .expect("Build test_fixture.rs with scratch harness"),
        ));
        let first = store.begin("codex-1").unwrap();
        assert!(store
            .login_url("codex-1", &first.login_id)
            .unwrap()
            .starts_with("https://auth.openai.com/"));
        assert!(store.login_url("codex-2", &first.login_id).is_err());
        assert!(store.begin("codex-2").is_err());
        assert_eq!(
            store.poll("codex-1", &first.login_id).unwrap().status,
            LoginStatus::Pending
        );
        let second = store.begin("codex-1").unwrap();
        assert_ne!(first.login_id, second.login_id);
        assert!(store.login_url("codex-1", &first.login_id).is_err());
        assert!(store.poll("codex-1", &first.login_id).is_err());
        assert!(store.cancel("codex-1", &first.login_id).is_err());
        assert_eq!(
            store.poll("codex-1", &second.login_id).unwrap().status,
            LoginStatus::Pending
        );
        store.cancel("codex-1", &second.login_id).unwrap();
        assert!(store.login_url("codex-1", &second.login_id).is_err());
        assert_eq!(
            store.poll("codex-1", &second.login_id).unwrap().status,
            LoginStatus::Failed
        );
        let home = store.home(1).unwrap();
        std::fs::write(home.join("fixture-mode"), "complete").unwrap();
        let completed = store.begin("codex-2").unwrap();
        let result = store.poll("codex-2", &completed.login_id).unwrap();
        assert_eq!(result.status, LoginStatus::Completed);
        let account = result.account.unwrap();
        // A successful synthetic login has no real principal credentials: do not
        // invent an email identity, query quota or reuse another slot's snapshot.
        assert!(account.identity.is_none());
        assert!(account.usage.is_none());
        assert_eq!(account.status, AccountStatus::Error);
        assert!(!std::fs::read_to_string(home.join("fixture-methods"))
            .unwrap()
            .contains("account/rateLimits/read"));
        std::fs::write(home.join("fixture-mode"), "failure").unwrap();
        let failed = store.begin("codex-2").unwrap();
        let result = store.poll("codex-2", &failed.login_id).unwrap();
        assert_eq!(result.status, LoginStatus::Failed);
        assert_eq!(result.error.as_deref(), Some("Codex login failed"));
        assert_eq!(storage::load(&store.root).unwrap(), store.list().unwrap());
        for i in 0..2 {
            for method in std::fs::read_to_string(store.home(i).unwrap().join("fixture-methods"))
                .unwrap()
                .lines()
            {
                assert!(matches!(
                    method,
                    "initialize"
                        | "initialized"
                        | "account/read"
                        | "account/login/start"
                        | "account/login/cancel"
                ));
            }
        }
    }

    #[test]
    #[ignore = "Explicit signed-out native Store refresh; no login or inference"]
    fn installed_signed_out_store_refresh() {
        let (_dir, store) = fixture();
        let result = store.refresh(Some("codex-1")).unwrap();
        assert_eq!(result[0].status, AccountStatus::AuthRequired);
        assert!(result[0].identity.is_none());
        assert!(result[0].usage.is_none());
        assert!(result[0].last_attempt_at.is_some());
        assert!(result[0].last_success_at.is_none());
        assert_eq!(storage::load(&store.root).unwrap(), result);
    }
}
