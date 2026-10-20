//! Narrow, supervised app-server transport. No public/general RPC surface.
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::codex::discovery;
use crate::codex::CliOwnedJob as OwnedJob;

const RPC_TIMEOUT: Duration = Duration::from_secs(20);
pub const LOGIN_LIFETIME: Duration = Duration::from_secs(600);
const MAX_FRAME: u64 = 1024 * 1024;

pub struct Client {
    child: Child,
    stdin: ChildStdin,
    frames: mpsc::Receiver<Value>,
    reader: Option<JoinHandle<()>>,
    job: Arc<OwnedJob>,
    watchdog: Option<JoinHandle<()>>,
    stopped: Arc<(Mutex<bool>, Condvar)>,
    next_id: u64,
    completion: Option<(String, bool)>,
}

/// Deliberate allowlist rather than trying to enumerate every provider override/key.
fn isolated_command(executable: &Path, home: &Path, work: &Path) -> Command {
    let mut cmd = Command::new(executable);
    cmd.env_clear();
    for name in [
        "SystemRoot",
        "WINDIR",
        "SystemDrive",
        "COMSPEC",
        "PATH",
        "PATHEXT",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
    ] {
        if let Some(v) = std::env::var_os(name) {
            cmd.env(name, v);
        }
    }
    cmd.env("CODEX_HOME", home)
        .env("HOME", home)
        .env("USERPROFILE", home)
        .env("APPDATA", home.join("os-roaming"))
        .env("LOCALAPPDATA", home.join("os-local"))
        .env("XDG_CONFIG_HOME", home.join("xdg-config"))
        .env("XDG_DATA_HOME", home.join("xdg-data"))
        .env("TEMP", home.join("tmp"))
        .env("TMP", home.join("tmp"))
        .env("TMPDIR", home.join("tmp"))
        .current_dir(work)
        .args([
            "-c",
            "cli_auth_credentials_store=\"keyring\"",
            "-c",
            "forced_login_method=\"chatgpt\"",
            "-c",
            "features.secret_auth_storage=false",
            "-c",
            "model_provider=\"openai\"",
            "-c",
            "chatgpt_base_url=\"https://chatgpt.com/backend-api/\"",
            "app-server",
            "--listen",
            "stdio://",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    cmd
}

impl Client {
    #[cfg(test)]
    pub(super) fn start_fixture(home: &Path, executable: &Path) -> Result<Self, String> {
        Self::start_executable(home, executable, LOGIN_LIFETIME)
    }

    pub fn start(home: &Path) -> Result<Self, String> {
        let (launch, _) = discovery::discover(None).map_err(|_| "Codex CLI discovery failed")?;
        // discovery.supported belongs to CHAT's pinned protocol, not this adapter.
        // This adapter proves its own initialize/account protocol per process.
        if !launch.prefix.is_empty() {
            return Err("Account monitoring requires the native Codex binary".into());
        }
        Self::start_executable(home, &launch.executable, LOGIN_LIFETIME)
    }

    fn start_executable(
        home: &Path,
        executable: &Path,
        lifetime: Duration,
    ) -> Result<Self, String> {
        let work = super::storage::directory(home, "work")?;
        for name in ["tmp", "os-roaming", "os-local", "xdg-config", "xdg-data"] {
            super::storage::directory(home, name)?;
        }
        // Never let a replaced home, credential file or config redirect this process
        // to the owner's native auth/config. Native auth is never opened here.
        for name in ["auth.json", "config.toml", ".codex"] {
            super::storage::reject_link(&home.join(name))?;
        }
        let mut child = isolated_command(executable, home, &work)
            .spawn()
            .map_err(|_| "Could not start isolated Codex account process")?;
        let job = match OwnedJob::assign(&child) {
            Ok(job) => Arc::new(job),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Could not own isolated Codex process tree".into());
            }
        };
        let stdin = child.stdin.take().ok_or("Codex stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("Codex stdout unavailable")?;
        let (tx, frames) = mpsc::sync_channel(64);
        let reader = std::thread::spawn(move || {
            let mut input = BufReader::new(stdout);
            loop {
                let mut bytes = Vec::new();
                let read = input
                    .by_ref()
                    .take(MAX_FRAME + 1)
                    .read_until(b'\n', &mut bytes);
                if !matches!(read, Ok(n) if n > 0) || bytes.len() as u64 > MAX_FRAME {
                    break;
                }
                let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                    break;
                };
                // Bounded channel: an overproducing/unexpected server fails closed.
                if tx.try_send(value).is_err() {
                    break;
                }
            }
        });
        let stopped = Arc::new((Mutex::new(false), Condvar::new()));
        let signal = stopped.clone();
        let kill = job.clone();
        let watchdog = std::thread::spawn(move || {
            let (lock, cv) = &*signal;
            if let Ok(guard) = lock.lock() {
                match cv.wait_timeout_while(guard, lifetime, |done| !*done) {
                    Ok((done, _)) if *done => {}
                    _ => kill.terminate(),
                }
            } else {
                kill.terminate();
            }
        });
        let mut client = Self {
            child,
            stdin,
            frames,
            reader: Some(reader),
            job,
            watchdog: Some(watchdog),
            stopped,
            next_id: 1,
            completion: None,
        };
        client.rpc("initialize",json!({"clientInfo":{"name":"tabs_provider_accounts","title":"TABS provider accounts","version":"1.0.0"},"capabilities":{"experimentalApi":true}}))?;
        client.send(json!({"method":"initialized","params":{}}))?;
        Ok(client)
    }

    fn send(&mut self, value: Value) -> Result<(), String> {
        let mut bytes =
            serde_json::to_vec(&value).map_err(|_| "Could not encode Codex account request")?;
        bytes.push(b'\n');
        self.stdin
            .write_all(&bytes)
            .and_then(|_| self.stdin.flush())
            .map_err(|_| "Codex account process stopped".into())
    }

    fn observe(&mut self, value: &Value) {
        if value.get("method").and_then(Value::as_str) == Some("account/login/completed") {
            if let (Some(id), Some(success)) = (
                value.pointer("/params/loginId").and_then(Value::as_str),
                value.pointer("/params/success").and_then(Value::as_bool),
            ) {
                self.completion = Some((id.into(), success));
            }
        }
    }

    fn rpc(&mut self, method: &str, params: Value) -> Result<Value, String> {
        if !matches!(
            method,
            "initialize"
                | "account/read"
                | "account/rateLimits/read"
                | "account/login/start"
                | "account/login/cancel"
        ) {
            return Err("Unsupported provider-account operation".into());
        }
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({"id":id,"method":method,"params":params}))?;
        let deadline = Instant::now() + RPC_TIMEOUT;
        loop {
            let value = self
                .frames
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| "Codex account request timed out or process exited")?;
            self.observe(&value);
            if value.get("id").and_then(Value::as_u64) == Some(id) {
                // Never surface backend errors: they can contain URLs, tokens or paths.
                if value.get("error").is_some() {
                    return Err(format!("Codex {method} failed"));
                }
                return value
                    .get("result")
                    .cloned()
                    .ok_or_else(|| "Invalid Codex account response".into());
            }
            if value.get("method").is_some() && value.get("id").is_some() {
                return Err("Unexpected server request in account-only protocol".into());
            }
        }
    }

    pub fn read_account(&mut self) -> Result<Value, String> {
        self.rpc("account/read", json!({"refreshToken":false}))
    }
    pub fn read_limits(&mut self) -> Result<Value, String> {
        self.rpc("account/rateLimits/read", json!({}))
    }
    pub fn begin_login(&mut self) -> Result<(String, String), String> {
        let result=self.rpc("account/login/start",json!({"type":"chatgpt","codexStreamlinedLogin":false,"useHostedLoginSuccessPage":false}))?;
        if result.get("type").and_then(Value::as_str) != Some("chatgpt") {
            return Err("Codex did not return a ChatGPT login".into());
        }
        let id = result
            .get("loginId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 256)
            .ok_or("Invalid Codex login identifier")?;
        let url = result
            .get("authUrl")
            .and_then(Value::as_str)
            .filter(|s| valid_auth_url(s))
            .ok_or("Codex returned an unsafe login URL")?;
        Ok((id.into(), url.into()))
    }
    pub fn cancel_login(&mut self, id: &str) -> Result<(), String> {
        self.rpc("account/login/cancel", json!({"loginId":id}))
            .map(|_| ())
    }
    pub fn login_completion(&mut self, id: &str) -> Result<Option<bool>, String> {
        loop {
            match self.frames.try_recv() {
                Ok(value) => self.observe(&value),
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    return Err("Codex login process exited".into())
                }
            }
        }
        Ok(self
            .completion
            .as_ref()
            .filter(|(completed, _)| completed == id)
            .map(|(_, success)| *success))
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        if let Ok(mut done) = self.stopped.0.lock() {
            *done = true;
            self.stopped.1.notify_all();
        }
        self.job.terminate();
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        if let Some(watchdog) = self.watchdog.take() {
            let _ = watchdog.join();
        }
    }
}

pub fn valid_auth_url(url: &str) -> bool {
    // Exact authority delimiter blocks userinfo, suffix hosts, ports and backslashes.
    url.len() <= 16384
        && url.starts_with("https://auth.openai.com/")
        && !url.chars().any(|c| c.is_control() || c == '\\')
}

pub fn keyring_user(home: &Path) -> Result<String, String> {
    let canonical = home
        .canonicalize()
        .map_err(|_| "Could not resolve isolated auth home")?;
    let digest = format!(
        "{:x}",
        Sha256::digest(canonical.to_string_lossy().as_bytes())
    );
    Ok(format!("cli|{}", &digest[..16]))
}

pub fn read_identity(home: &Path, account: &Value) -> Option<super::model::Identity> {
    // Codex 0.159.2 direct backend, official login/src/auth/storage.rs:
    // service="Codex Auth", user="cli|" + first16(sha256(canonical CODEX_HOME)).
    // features.secret_auth_storage=false selects this HOME-specific backend.
    // Do not enumerate the keyring, read auth.json or try a native/default HOME.
    let user = keyring_user(home).ok()?;
    let serialized = keyring::Entry::new("Codex Auth", &user)
        .ok()?
        .get_password()
        .ok()?;
    identity_from_serialized(account, &serialized)
}

fn identity_from_serialized(account: &Value, serialized: &str) -> Option<super::model::Identity> {
    if serialized.len() > 1024 * 1024 {
        return None;
    }
    let auth: Value = serde_json::from_str(serialized).ok()?;
    let jwt = auth.pointer("/tokens/id_token").and_then(Value::as_str)?;
    if jwt.len() > 128 * 1024 {
        return None;
    }
    let parts: Vec<_> = jwt.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|s| s.is_empty()) {
        return None;
    }
    let payload = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    let claims: Value = serde_json::from_slice(&payload).ok()?;
    let identity = super::model::identity_from_claims(account, &claims)?;
    if auth
        .pointer("/tokens/account_id")
        .and_then(Value::as_str)
        .is_some_and(|id| Some(id) != identity.workspace_id.as_deref())
    {
        return None;
    }
    Some(identity)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_sanitized_composite_identity_leaves_auth_parser() {
        let claims = json!({"https://api.openai.com/auth":{"chatgpt_user_id":"synthetic-user","chatgpt_account_id":"synthetic-workspace"}});
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
        // Synthetic envelope, not a credential and not usable for authorization.
        let auth = json!({"tokens":{"id_token":format!("synthetic.{payload}.synthetic"),"account_id":"synthetic-workspace"}});
        let account = json!({"account":{"type":"chatgpt","email":"synthetic@example.test","planType":"plus"},"workspaceRouting":{"chatgptAccountId":"synthetic-workspace"}});
        let identity = identity_from_serialized(&account, &auth.to_string()).unwrap();
        let output = serde_json::to_string(&identity).unwrap();
        assert!(!output.contains("id_token"));
        assert!(!output.contains(&payload));
        assert!(!output.contains("synthetic-user"));
        assert_eq!(
            identity.workspace_id.as_deref(),
            Some("synthetic-workspace")
        );
        let mut wrong = auth.clone();
        wrong["tokens"]["account_id"] = json!("other-workspace");
        assert!(identity_from_serialized(&account, &wrong.to_string()).is_none());
        assert!(identity_from_serialized(&account, "malformed").is_none());
    }

    #[test]
    #[ignore = "Requires explicitly built network-free TABS_PROVIDER_TEST_FIXTURE binary"]
    fn synthetic_abandoned_login_watchdog_kills_process() {
        let dir = tempfile::Builder::new()
            .prefix("tabs-watchdog-")
            .tempdir_in(super::super::storage::test_temp_root())
            .unwrap();
        let executable =
            std::path::PathBuf::from(std::env::var_os("TABS_PROVIDER_TEST_FIXTURE").unwrap());
        let mut client = Client::start_executable(
            &dir.path().canonicalize().unwrap(),
            &executable,
            Duration::from_millis(200),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if client.child.try_wait().unwrap().is_some() {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "watchdog did not terminate abandoned login process"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(client.read_account().is_err());
    }
    #[test]
    fn login_url_is_fixed_https_authority() {
        assert!(valid_auth_url(
            "https://auth.openai.com/oauth/authorize?state=test"
        ));
        for u in [
            "https://auth.openai.com.evil.test/",
            "https://auth.openai.com@evil.test/",
            "http://auth.openai.com/",
            "https://auth.openai.com:443/",
            "https://auth.openai.com/\\evil",
            "https://auth.openai.com/\n",
        ] {
            assert!(!valid_auth_url(u));
        }
    }
    #[test]
    fn keyring_names_and_environment_are_home_isolated() {
        let dir = tempfile::Builder::new()
            .prefix("tabs-account-isolation-")
            .tempdir_in(super::super::storage::test_temp_root())
            .unwrap();
        let a = super::super::storage::directory(dir.path(), "codex-1").unwrap();
        let b = super::super::storage::directory(dir.path(), "codex-2").unwrap();
        assert_ne!(keyring_user(&a).unwrap(), keyring_user(&b).unwrap());
        let c = isolated_command(Path::new("codex.exe"), &a, &a);
        let env: std::collections::HashMap<_, _> = c
            .get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect();
        assert_eq!(env["CODEX_HOME"], Some(a.to_string_lossy().into_owned()));
        for name in [
            "OPENAI_API_KEY",
            "CODEX_API_KEY",
            "OPENAI_BASE_URL",
            "AZURE_OPENAI_API_KEY",
            "CODEX_HOME_OVERRIDE",
            "HTTP_PROXY",
        ] {
            assert!(!env.contains_key(name));
        }
    }
    #[test]
    #[ignore = "Explicit signed-out installed CLI protocol smoke; never logs in or runs inference"]
    fn installed_codex_signed_out_protocol() {
        let dir = tempfile::Builder::new()
            .prefix("tabs-codex-protocol-")
            .tempdir_in(super::super::storage::test_temp_root())
            .unwrap();
        let home = dir.path().canonicalize().unwrap();
        let mut c = Client::start(&home).unwrap();
        let account = c.read_account().unwrap();
        assert!(account.get("account").map_or(true, Value::is_null));
        assert!(read_identity(&home, &account).is_none());
        assert!(c.read_limits().is_err());
        let pid = c.child.id();
        drop(c);
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::System::Threading::{
                OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
            };
            let h = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
            if !h.is_null() {
                assert_eq!(WaitForSingleObject(h, 0), 0);
                windows_sys::Win32::Foundation::CloseHandle(h);
            }
        }
    }
}
