mod discovery;
mod journal;
mod process;
mod protocol;

pub use discovery::Discovery;
pub use protocol::{HostError, HostEvent, HostResult, Replay, RequestReply};

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use self::discovery::Launch;
use self::journal::Journal;
use self::process::OwnedJob;

pub(crate) use self::process::OwnedJob as CliOwnedJob;
use self::protocol::{
    HostEventKind, JsonlDecoder, PendingRequestView, MAX_FRAME_BYTES, MAX_TEXT_BYTES,
};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const RPC_TIMEOUT: Duration = Duration::from_secs(30);
const EXIT_GRACE: Duration = Duration::from_secs(5);
const EVENT_CAPACITY: usize = 1024;
const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub epoch: u64,
    pub executable_path: String,
    pub version: String,
    pub workspace_root: String,
    pub auth_mode: &'static str,
    pub model_provider: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
    pub reasoning_efforts: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTurn {
    pub id: String,
    pub status: String,
    pub assistant_items: Vec<NativeAssistantItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAssistantItem {
    pub id: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStart {
    pub epoch: u64,
    pub login_id: String,
    pub auth_url: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRequest {
    pub epoch: u64,
    pub workspace_root: String,
    pub permission_profile: PermissionProfile,
    pub approval_policy: ApprovalPolicy,
    pub model: Option<String>,
    #[serde(default)]
    pub tools: Vec<ToolSpec>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionProfile {
    ReadOnly,
    WorkspaceWrite,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub enum ApprovalPolicy {
    #[serde(rename = "never")]
    Never,
    #[serde(rename = "on-request")]
    OnRequest,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRequest {
    pub epoch: u64,
    pub thread_id: String,
    pub text: String,
    #[serde(default)]
    pub images: Vec<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
}

#[derive(Clone)]
struct ServerRequest {
    native_id: Value,
    kind: String,
    method: String,
    epoch: u64,
}

struct Shared {
    epoch: u64,
    workspace_root: std::path::PathBuf,
    allowed_threads: HashSet<String>,
    thread_tools: HashMap<String, HashSet<String>>,
    active_turns: HashMap<String, String>,
    next_rpc_id: u64,
    next_request_id: u64,
    sequence: u64,
    events: VecDeque<HostEvent>,
    pending_rpc: HashMap<u64, mpsc::Sender<HostResult<Value>>>,
    pending_requests: HashMap<String, ServerRequest>,
    running: bool,
    journal: Option<Journal>,
    journal_fault: bool,
}

impl Shared {
    fn new() -> Self {
        Self {
            epoch: 0,
            workspace_root: std::path::PathBuf::new(),
            allowed_threads: HashSet::new(),
            thread_tools: HashMap::new(),
            active_turns: HashMap::new(),
            next_rpc_id: 1,
            next_request_id: 1,
            sequence: 0,
            events: VecDeque::new(),
            pending_rpc: HashMap::new(),
            pending_requests: HashMap::new(),
            running: false,
            journal: None,
            journal_fault: false,
        }
    }
}

struct OwnedProcess {
    child: Child,
    job: Arc<OwnedJob>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    stdout_thread: Option<JoinHandle<()>>,
    stderr_thread: Option<JoinHandle<()>>,
}

pub struct CodexHost {
    shared: Arc<Mutex<Shared>>,
    lifecycle: Mutex<()>,
    process: Mutex<Option<OwnedProcess>>,
    connection: Mutex<Option<Connection>>,
    login_id: Mutex<Option<String>>,
    protected_roots: Vec<std::path::PathBuf>,
    emit: Arc<dyn Fn(HostEvent) + Send + Sync>,
}

impl CodexHost {
    pub fn new(emit: impl Fn(HostEvent) + Send + Sync + 'static) -> Self {
        Self {
            shared: Arc::new(Mutex::new(Shared::new())),
            lifecycle: Mutex::new(()),
            process: Mutex::new(None),
            connection: Mutex::new(None),
            login_id: Mutex::new(None),
            protected_roots: Vec::new(),
            emit: Arc::new(emit),
        }
    }

    pub fn with_protected_roots(mut self, roots: Vec<std::path::PathBuf>) -> Self {
        self.protected_roots = roots;
        self
    }

    pub fn with_journal(self, folder: &Path) -> Self {
        {
            let mut shared = self.shared.lock().unwrap();
            match Journal::open(folder) {
                Ok(journal) => {
                    (shared.epoch, shared.sequence) = journal.counters();
                    shared.journal = Some(journal);
                }
                Err(_) => shared.journal_fault = true,
            }
        }
        self
    }

    pub fn discover(path: Option<&str>) -> HostResult<Discovery> {
        discovery::discover(path).map(|(_, result)| result)
    }

    pub fn status(&self) -> Option<Connection> {
        if !self.shared.lock().unwrap().running {
            return None;
        }
        self.connection.lock().unwrap().clone()
    }

    pub fn connect(
        &self,
        executable_path: Option<&str>,
        workspace_root: &str,
    ) -> HostResult<Connection> {
        let _lifecycle = self.lifecycle.lock().unwrap();
        if self.shared.lock().unwrap().journal_fault {
            return Err(HostError::new(
                "internal",
                "Codex event journal is unavailable; AI execution is stopped",
            ));
        }
        let has_process = self.process.lock().unwrap().is_some();
        if has_process {
            if self.shared.lock().unwrap().running && self.login_id.lock().unwrap().is_none() {
                return Err(HostError::new(
                    "busy",
                    "A Codex process is already connected",
                ));
            }
            self.disconnect_inner();
        }
        let cwd = canonical_directory(workspace_root)?;
        let (launch, found) = discovery::discover(executable_path)?;
        if !found.supported {
            return Err(HostError::new(
                "unsupported_version",
                format!(
                    "Codex {} has not been validated for this TABS build",
                    found.version
                ),
            ));
        }

        // First process reads only configured MCP server names. An empty TOML table
        // merges inherited servers, so the second process disables each by name.
        self.spawn(&launch, &cwd, &[])?;
        let result = (|| {
            self.handshake()?;
            let config = self.rpc(
                "config/read",
                json!({"cwd":cwd,"includeLayers":false}),
                RPC_TIMEOUT,
            )?;
            let servers = config
                .pointer("/config/mcp_servers")
                .and_then(Value::as_object);
            let names: Vec<String> = servers
                .map(|s| s.keys().cloned().collect())
                .unwrap_or_default();
            if names
                .iter()
                .any(|name| name.len() > 128 || name.contains('\n') || name.contains('\r'))
            {
                return Err(HostError::new(
                    "incompatible_provider",
                    "Codex has an invalid inherited tool-server name",
                ));
            }
            Ok(names)
        })();
        self.disconnect_inner();
        let names = result?;

        self.spawn(&launch, &cwd, &names)?;
        let result = (|| {
            self.handshake()?;
            let config = self.rpc(
                "config/read",
                json!({"cwd":cwd,"includeLayers":false}),
                RPC_TIMEOUT,
            )?;
            let effective = config.get("config").ok_or_else(|| {
                HostError::new(
                    "protocol_error",
                    "Codex did not report effective configuration",
                )
            })?;
            let provider = effective
                .get("model_provider")
                .and_then(Value::as_str)
                .unwrap_or("openai");
            let custom = effective.get("model_providers").and_then(Value::as_object);
            if provider != "openai" || custom.is_some_and(|providers| !providers.is_empty()) {
                return Err(HostError::new(
                    "incompatible_provider",
                    "Codex uses an unapproved model provider",
                ));
            }
            let servers = effective.get("mcp_servers").and_then(Value::as_object);
            if servers.is_some_and(|servers| {
                servers
                    .values()
                    .any(|server| server.get("enabled") != Some(&Value::Bool(false)))
            }) {
                return Err(HostError::new(
                    "incompatible_provider",
                    "Inherited Codex tools were not disabled",
                ));
            }
            let features = effective.get("features").and_then(Value::as_object);
            if ["plugins", "hooks", "remote_plugin", "apps"]
                .iter()
                .any(|name| {
                    features.and_then(|flags| flags.get(*name)) != Some(&Value::Bool(false))
                })
            {
                return Err(HostError::new(
                    "incompatible_provider",
                    "Inherited Codex features were not disabled",
                ));
            }
            if effective
                .get("openai_base_url")
                .is_some_and(|value| !value.is_null())
                || effective
                    .get("openai_api_base")
                    .is_some_and(|value| !value.is_null())
            {
                return Err(HostError::new(
                    "incompatible_provider",
                    "Codex uses an unapproved API endpoint",
                ));
            }
            if effective
                .pointer("/windows/sandbox")
                .and_then(Value::as_str)
                != Some("elevated")
            {
                return Err(HostError::new(
                    "incompatible_provider",
                    "The tested Windows Codex sandbox profile is unavailable",
                ));
            }
            if effective.get("web_search").and_then(Value::as_str) != Some("disabled") {
                return Err(HostError::new(
                    "incompatible_provider",
                    "Codex web search could not be disabled for this session",
                ));
            }
            let statuses = self.rpc("mcpServerStatus/list", json!({}), RPC_TIMEOUT)?;
            let data = statuses
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    HostError::new("protocol_error", "Codex tool status was malformed")
                })?;
            if data.len() != names.len()
                || data.iter().any(|item| {
                    item.get("pluginId").is_some_and(|value| !value.is_null())
                        || item
                            .get("tools")
                            .and_then(Value::as_object)
                            .is_some_and(|tools| !tools.is_empty())
                        || !item
                            .get("name")
                            .and_then(Value::as_str)
                            .is_some_and(|name| names.iter().any(|expected| expected == name))
                })
            {
                return Err(HostError::new(
                    "incompatible_provider",
                    "Inherited Codex tools remain available",
                ));
            }
            Ok(())
        })();
        if let Err(error) = result {
            self.disconnect_inner();
            return Err(error);
        }
        let connection = Connection {
            epoch: self.shared.lock().unwrap().epoch,
            executable_path: found.executable_path,
            version: found.version,
            workspace_root: cwd.to_string_lossy().into_owned(),
            auth_mode: "chatgpt",
            model_provider: "openai",
        };
        *self.connection.lock().unwrap() = Some(connection.clone());
        self.record(HostEventKind::Status {
            status: "ready".into(),
            message: None,
        });
        if self.shared.lock().unwrap().journal_fault {
            self.disconnect_inner();
            return Err(HostError::new(
                "internal",
                "Codex event journal is unavailable; AI execution is stopped",
            ));
        }
        Ok(connection)
    }

    fn handshake(&self) -> HostResult<()> {
        self.initialize_only()?;
        let account = self.rpc("account/read", json!({"refreshToken":false}), RPC_TIMEOUT)?;
        match account.pointer("/account/type").and_then(Value::as_str) {
            Some("chatgpt") => Ok(()),
            Some(_) => Err(HostError::new(
                "incompatible_account",
                "Codex is not signed in with ChatGPT",
            )),
            None => Err(HostError::new(
                "auth_required",
                "Sign in to Codex with ChatGPT",
            )),
        }
    }

    fn initialize_only(&self) -> HostResult<()> {
        self.rpc("initialize", json!({"clientInfo":{"name":"tabs","title":"TABS","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}}), STARTUP_TIMEOUT)?;
        self.notify("initialized", json!({}))?;
        Ok(())
    }

    pub fn begin_login(
        &self,
        executable_path: Option<&str>,
        workspace_root: &str,
    ) -> HostResult<LoginStart> {
        let _lifecycle = self.lifecycle.lock().unwrap();
        if self.process.lock().unwrap().is_some() {
            return Err(HostError::new(
                "busy",
                "Disconnect TABS Codex before starting a new login",
            ));
        }
        let cwd = canonical_directory(workspace_root)?;
        let (launch, found) = discovery::discover(executable_path)?;
        if !found.supported {
            return Err(HostError::new(
                "unsupported_version",
                "Codex version is not supported",
            ));
        }
        self.spawn(&launch, &cwd, &[])?;
        let result = (|| {
            self.initialize_only()?;
            let response = self.rpc(
                "account/login/start",
                json!({"type":"chatgpt"}),
                RPC_TIMEOUT,
            )?;
            let login_id = response
                .get("loginId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    HostError::new("protocol_error", "Codex did not return a login ID")
                })?;
            let auth_url = response
                .get("authUrl")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    HostError::new("protocol_error", "Codex did not return a login URL")
                })?;
            if login_id.is_empty()
                || login_id.len() > 256
                || auth_url.len() > 4096
                || !auth_url.starts_with("https://")
            {
                return Err(HostError::new(
                    "protocol_error",
                    "Codex returned an invalid login URL",
                ));
            }
            Ok(LoginStart {
                epoch: self.shared.lock().unwrap().epoch,
                login_id: login_id.into(),
                auth_url: auth_url.into(),
            })
        })();
        match result {
            Ok(login) => {
                *self.login_id.lock().unwrap() = Some(login.login_id.clone());
                Ok(login)
            }
            Err(error) => {
                self.disconnect_inner();
                Err(error)
            }
        }
    }

    pub fn cancel_login(&self, epoch: u64, login_id: &str) -> HostResult<()> {
        self.check_epoch(epoch)?;
        if self.login_id.lock().unwrap().as_deref() != Some(login_id) {
            return Err(HostError::new(
                "stale_request",
                "Codex login is no longer pending",
            ));
        }
        let result = self
            .rpc(
                "account/login/cancel",
                json!({"loginId":login_id}),
                RPC_TIMEOUT,
            )
            .map(|_| ());
        self.disconnect();
        result
    }

    fn spawn(&self, launch: &Launch, cwd: &Path, disabled_mcp: &[String]) -> HostResult<()> {
        let cwd = cwd.canonicalize().map_err(|_| {
            HostError::new(
                "invalid_argument",
                "Could not resolve Codex process workspace",
            )
        })?;
        if !cwd.is_dir() {
            return Err(HostError::new(
                "invalid_argument",
                "Codex process workspace is not a directory",
            ));
        }
        let epoch = {
            let mut shared = self.shared.lock().unwrap();
            if shared.journal_fault {
                return Err(HostError::new(
                    "internal",
                    "Codex event journal is unavailable; AI execution is stopped",
                ));
            }
            let next = if let Some(journal) = shared.journal.as_mut() {
                journal.next_epoch()?
            } else {
                shared.epoch.saturating_add(1)
            };
            shared.epoch = next;
            next
        };
        let mut command = Command::new(&launch.executable);
        command
            .args(&launch.prefix)
            .args(["app-server", "--stdio", "--strict-config"]);
        command.args(["-c", "windows.sandbox=elevated"]);
        command.args(["-c", "sandbox_workspace_write.network_access=false"]);
        // Native Codex search defaults to cached mode. TABS has no per-turn
        // opt-in control on this binary, so keep the tool absent.
        command.args(["-c", "web_search=\"disabled\""]);
        for flag in ["plugins", "hooks", "remote_plugin", "apps"] {
            command.args(["--disable", flag]);
        }
        for name in disabled_mcp {
            let key = if name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            {
                name.clone()
            } else {
                serde_json::to_string(name)
                    .map_err(|_| HostError::new("invalid_argument", "Invalid MCP server name"))?
            };
            command.args(["-c", &format!("mcp_servers.{key}.enabled=false")]);
        }
        command
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for key in [
            "OPENAI_API_KEY",
            "CODEX_API_KEY",
            "ANTHROPIC_API_KEY",
            "GOOGLE_API_KEY",
            "GEMINI_API_KEY",
            "OPENROUTER_API_KEY",
            "XAI_API_KEY",
            "NVIDIA_API_KEY",
            "AZURE_OPENAI_API_KEY",
            "OPENAI_BASE_URL",
            "OPENAI_API_BASE",
            "ANTHROPIC_BASE_URL",
            "OPENROUTER_BASE_URL",
            "AZURE_OPENAI_ENDPOINT",
        ] {
            command.env_remove(key);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|_| HostError::new("not_found", "Could not launch Codex app-server"))?;
        let job = match OwnedJob::assign(&child) {
            Ok(job) => Arc::new(job),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let stdin = Arc::new(Mutex::new(child.stdin.take()));
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| HostError::new("internal", "Codex stdout was unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| HostError::new("internal", "Codex stderr was unavailable"))?;
        let epoch = {
            let mut shared = self.shared.lock().unwrap();
            shared.epoch = epoch;
            shared.workspace_root = cwd;
            shared.allowed_threads.clear();
            shared.thread_tools.clear();
            shared.active_turns.clear();
            shared.next_rpc_id = 1;
            shared.next_request_id = 1;
            shared.pending_requests.clear();
            shared.running = true;
            shared.epoch
        };
        let shared = Arc::clone(&self.shared);
        let emit = Arc::clone(&self.emit);
        let reader_stdin = Arc::clone(&stdin);
        let reader_job = Arc::clone(&job);
        let stdout_thread = std::thread::spawn(move || {
            read_stdout(stdout, epoch, shared, reader_stdin, reader_job, emit);
        });
        let shared = Arc::clone(&self.shared);
        let emit = Arc::clone(&self.emit);
        let stderr_thread = std::thread::spawn(move || {
            read_stderr(stderr, epoch, shared, emit);
        });
        *self.process.lock().unwrap() = Some(OwnedProcess {
            child,
            job,
            stdin,
            stdout_thread: Some(stdout_thread),
            stderr_thread: Some(stderr_thread),
        });
        Ok(())
    }

    fn check_epoch(&self, epoch: u64) -> HostResult<()> {
        let shared = self.shared.lock().unwrap();
        if !shared.running || shared.epoch != epoch {
            Err(HostError::new(
                "stale_epoch",
                "Codex session epoch is no longer active",
            ))
        } else {
            Ok(())
        }
    }

    fn write_wire(&self, value: &Value) -> HostResult<()> {
        let stdin = self
            .process
            .lock()
            .unwrap()
            .as_ref()
            .map(|process| Arc::clone(&process.stdin))
            .ok_or_else(|| HostError::new("transport_closed", "Codex is disconnected"))?;
        write_wire(&stdin, value)
    }

    fn notify(&self, method: &str, params: Value) -> HostResult<()> {
        self.write_wire(&json!({"method":method,"params":params}))
    }

    fn rpc(&self, method: &str, params: Value, timeout: Duration) -> HostResult<Value> {
        let (tx, rx) = mpsc::channel();
        let id = {
            let mut shared = self.shared.lock().unwrap();
            if !shared.running {
                return Err(HostError::new("transport_closed", "Codex is disconnected"));
            }
            let id = shared.next_rpc_id;
            shared.next_rpc_id += 1;
            shared.pending_rpc.insert(id, tx);
            id
        };
        if let Err(error) = self.write_wire(&json!({"id":id,"method":method,"params":params})) {
            self.shared.lock().unwrap().pending_rpc.remove(&id);
            return Err(error);
        }
        match rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(_) => {
                self.shared.lock().unwrap().pending_rpc.remove(&id);
                Err(HostError::new(
                    "timeout",
                    format!("Codex {method} did not reply in time"),
                ))
            }
        }
    }

    pub fn list_models(&self, epoch: u64) -> HostResult<Vec<Model>> {
        self.check_epoch(epoch)?;
        let result = self.rpc("model/list", json!({"includeHidden":false}), RPC_TIMEOUT)?;
        let data = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| HostError::new("protocol_error", "Codex model list was malformed"))?;
        if data.len() > 128 {
            return Err(HostError::new(
                "protocol_error",
                "Codex model list exceeds limit",
            ));
        }
        data.iter()
            .map(|item| {
                let id = item
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| HostError::new("protocol_error", "Codex model has no ID"))?;
                let efforts = item
                    .get("supportedReasoningEfforts")
                    .and_then(Value::as_array)
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| {
                                value
                                    .get("reasoningEffort")
                                    .and_then(Value::as_str)
                                    .or_else(|| value.as_str())
                            })
                            .map(str::to_owned)
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(Model {
                    id: id.into(),
                    display_name: item
                        .get("displayName")
                        .and_then(Value::as_str)
                        .unwrap_or(id)
                        .into(),
                    is_default: item
                        .get("isDefault")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    reasoning_efforts: efforts,
                })
            })
            .collect()
    }

    pub fn start_thread(&self, request: ThreadRequest) -> HostResult<String> {
        self.check_epoch(request.epoch)?;
        validate_tools(&request.tools)?;
        let cwd = canonical_directory(&request.workspace_root)?;
        if cwd != self.shared.lock().unwrap().workspace_root {
            return Err(HostError::new(
                "invalid_argument",
                "Thread workspace differs from connected workspace",
            ));
        }
        if matches!(
            request.permission_profile,
            PermissionProfile::WorkspaceWrite
        ) && self
            .protected_roots
            .iter()
            .try_fold(false, |conflict, protected| {
                Ok::<bool, HostError>(conflict || root_overlaps_protected(&cwd, protected)?)
            })?
        {
            return Err(HostError::new(
                "invalid_argument",
                "Writable Codex workspace overlaps TABS or Codex application data",
            ));
        }
        validate_optional_id(request.model.as_deref())?;
        let sandbox = match request.permission_profile {
            PermissionProfile::ReadOnly => "read-only",
            PermissionProfile::WorkspaceWrite => "workspace-write",
        };
        let approval = match request.approval_policy {
            ApprovalPolicy::Never => "never",
            ApprovalPolicy::OnRequest => "on-request",
        };
        let dynamic_tools: Vec<Value> = request
            .tools
            .iter()
            .map(|tool| {
                json!({
                    "type":"function","name":tool.name,"description":tool.description,
                    "inputSchema":tool.input_schema,
                })
            })
            .collect();
        let result = self.rpc("thread/start", json!({"cwd":cwd,"model":request.model,"sandbox":sandbox,"approvalPolicy":approval,"dynamicTools":dynamic_tools,"serviceName":"tabs"}), RPC_TIMEOUT)?;
        let id = result
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| HostError::new("protocol_error", "Codex did not return a thread ID"))?;
        {
            let mut shared = self.shared.lock().unwrap();
            shared.allowed_threads.insert(id.clone());
            shared.thread_tools.insert(
                id.clone(),
                request.tools.into_iter().map(|tool| tool.name).collect(),
            );
        }
        Ok(id)
    }

    pub fn resume_thread(
        &self,
        epoch: u64,
        thread_id: &str,
        tools: Vec<ToolSpec>,
    ) -> HostResult<String> {
        self.check_epoch(epoch)?;
        validate_id(thread_id)?;
        validate_tools(&tools)?;
        let result = self.rpc("thread/resume", json!({"threadId":thread_id}), RPC_TIMEOUT)?;
        let id = result
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                HostError::new("protocol_error", "Codex did not return a resumed thread ID")
            })?;
        if id != thread_id {
            return Err(HostError::new(
                "protocol_error",
                "Codex resumed a different thread",
            ));
        }
        let cwd = result.get("cwd").and_then(Value::as_str).ok_or_else(|| {
            HostError::new("protocol_error", "Codex did not report resumed workspace")
        })?;
        if canonical_directory(cwd)? != self.shared.lock().unwrap().workspace_root {
            return Err(HostError::new(
                "invalid_argument",
                "Resumed Codex thread belongs to another workspace",
            ));
        }
        {
            let mut shared = self.shared.lock().unwrap();
            shared.allowed_threads.insert(id.into());
            shared
                .thread_tools
                .insert(id.into(), tools.into_iter().map(|tool| tool.name).collect());
        }
        Ok(id.into())
    }

    pub fn read_thread(&self, epoch: u64, thread_id: &str) -> HostResult<Vec<NativeTurn>> {
        self.check_epoch(epoch)?;
        validate_id(thread_id)?;
        if !self
            .shared
            .lock()
            .unwrap()
            .allowed_threads
            .contains(thread_id)
        {
            return Err(HostError::new(
                "invalid_argument",
                "Codex thread is not owned by this connection",
            ));
        }
        let result = self.rpc(
            "thread/read",
            json!({"threadId":thread_id,"includeTurns":true}),
            RPC_TIMEOUT,
        )?;
        let cwd = result
            .pointer("/thread/cwd")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                HostError::new("protocol_error", "Codex did not report thread workspace")
            })?;
        if canonical_directory(cwd)? != self.shared.lock().unwrap().workspace_root {
            return Err(HostError::new(
                "invalid_argument",
                "Codex thread belongs to another workspace",
            ));
        }
        let turns = result
            .pointer("/thread/turns")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                HostError::new("protocol_error", "Codex thread history was malformed")
            })?;
        if turns.len() > 1000 {
            return Err(HostError::new(
                "protocol_error",
                "Codex thread history is too large to reconcile",
            ));
        }
        let mut total_text = 0usize;
        turns
            .iter()
            .map(|turn| {
                let native_items =
                    turn.get("items").and_then(Value::as_array).ok_or_else(|| {
                        HostError::new("protocol_error", "Codex turn items were malformed")
                    })?;
                let mut assistant_items = Vec::new();
                for item in native_items {
                    if item.get("type").and_then(Value::as_str) != Some("agentMessage") {
                        continue;
                    }
                    let id = item.get("id").and_then(Value::as_str).ok_or_else(|| {
                        HostError::new("protocol_error", "Codex assistant item lacks an ID")
                    })?;
                    let text = item.get("text").and_then(Value::as_str).ok_or_else(|| {
                        HostError::new("protocol_error", "Codex assistant item lacks text")
                    })?;
                    total_text = total_text.saturating_add(text.len());
                    if text.len() > 256 * 1024 || total_text > 2 * 1024 * 1024 {
                        return Err(HostError::new(
                            "protocol_error",
                            "Codex history exceeds reconciliation limit",
                        ));
                    }
                    assistant_items.push(NativeAssistantItem {
                        id: id.into(),
                        text: text.into(),
                    });
                }
                Ok(NativeTurn {
                    id: turn
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| HostError::new("protocol_error", "Codex turn lacks an ID"))?
                        .to_owned(),
                    status: turn
                        .get("status")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            HostError::new("protocol_error", "Codex turn lacks a status")
                        })?
                        .to_owned(),
                    assistant_items,
                })
            })
            .collect()
    }

    pub fn start_turn(&self, request: TurnRequest) -> HostResult<String> {
        self.check_epoch(request.epoch)?;
        validate_id(&request.thread_id)?;
        if !self
            .shared
            .lock()
            .unwrap()
            .allowed_threads
            .contains(&request.thread_id)
        {
            return Err(HostError::new(
                "invalid_argument",
                "Codex thread is not owned by this connection",
            ));
        }
        if request.text.is_empty() || request.text.len() > MAX_TEXT_BYTES {
            return Err(HostError::new(
                "invalid_argument",
                "Codex turn text is empty or exceeds limit",
            ));
        }
        validate_optional_id(request.model.as_deref())?;
        validate_optional_id(request.effort.as_deref())?;
        if request.images.len() > 4 {
            return Err(HostError::new("invalid_argument", "Too many Codex images"));
        }
        let mut input = vec![json!({"type":"text","text":request.text})];
        let mut total_image_bytes = 0usize;
        for image in &request.images {
            let (item, len) = validated_image_input(image)?;
            total_image_bytes += len;
            if total_image_bytes > MAX_IMAGE_TOTAL_BYTES {
                return Err(HostError::new(
                    "invalid_argument",
                    "Codex images exceed the size limit",
                ));
            }
            input.push(item);
        }
        let result = self.rpc("turn/start", json!({"threadId":request.thread_id,"input":input,"model":request.model,"effort":request.effort}), RPC_TIMEOUT)?;
        let turn_id = result
            .pointer("/turn/id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| HostError::new("protocol_error", "Codex did not return a turn ID"))?;
        self.shared
            .lock()
            .unwrap()
            .active_turns
            .insert(request.thread_id, turn_id.clone());
        Ok(turn_id)
    }

    pub fn interrupt_turn(&self, epoch: u64, thread_id: &str, turn_id: &str) -> HostResult<()> {
        self.check_epoch(epoch)?;
        validate_id(thread_id)?;
        if !self
            .shared
            .lock()
            .unwrap()
            .allowed_threads
            .contains(thread_id)
        {
            return Err(HostError::new(
                "invalid_argument",
                "Codex thread is not owned by this connection",
            ));
        }
        validate_id(turn_id)?;
        self.rpc(
            "turn/interrupt",
            json!({"threadId":thread_id,"turnId":turn_id}),
            RPC_TIMEOUT,
        )?;
        // A held tool callback may not emit serverRequest/resolved after interrupt.
        self.shared
            .lock()
            .unwrap()
            .pending_requests
            .retain(|_, pending| pending.epoch != epoch);
        Ok(())
    }

    pub fn reply_request(
        &self,
        epoch: u64,
        request_id: &str,
        reply: RequestReply,
    ) -> HostResult<()> {
        self.check_epoch(epoch)?;
        match &reply {
            RequestReply::Question { answers }
                if answers.len() > 12
                    || answers.iter().any(|(key, values)| {
                        key.len() > 128
                            || values.len() > 8
                            || values.iter().any(|answer| answer.len() > 4096)
                    }) =>
            {
                return Err(HostError::new(
                    "invalid_argument",
                    "Codex answers exceed limit",
                ));
            }
            RequestReply::BusinessTool { text, .. } if text.len() > MAX_TEXT_BYTES => {
                return Err(HostError::new(
                    "invalid_argument",
                    "Codex tool result exceeds limit",
                ));
            }
            _ => {}
        }
        let pending = {
            let mut shared = self.shared.lock().unwrap();
            let entry = shared.pending_requests.get(request_id).ok_or_else(|| {
                HostError::new("stale_request", "Codex request is no longer pending")
            })?;
            let matches = matches!(
                (&reply, entry.kind.as_str()),
                (
                    RequestReply::FileChangeApproval { .. },
                    "fileChangeApproval"
                ) | (RequestReply::CommandApproval { .. }, "commandApproval")
                    | (RequestReply::Question { .. }, "question")
                    | (RequestReply::BusinessTool { .. }, "businessTool")
            );
            if !matches || entry.epoch != epoch {
                return Err(HostError::new(
                    "stale_request",
                    "Codex request kind or epoch changed",
                ));
            }
            shared.pending_requests.remove(request_id).unwrap()
        };
        let result = match reply {
            RequestReply::FileChangeApproval { decision } => json!({"decision":decision}),
            RequestReply::CommandApproval { decision } => {
                if pending.method == "item/execCommand/requestApproval"
                    || pending.method == "item/applyPatch/requestApproval"
                {
                    let legacy = match decision {
                        protocol::ApprovalDecision::Accept => json!("approved"),
                        protocol::ApprovalDecision::Decline => {
                            json!({"denied":{"rejection":"User declined"}})
                        }
                        protocol::ApprovalDecision::Cancel => json!("abort"),
                    };
                    json!({"decision":legacy})
                } else {
                    json!({"decision":decision})
                }
            }
            RequestReply::Question { answers } => {
                json!({"answers":answers.into_iter().map(|(key, values)| (key, json!({"answers":values}))).collect::<serde_json::Map<String, Value>>()})
            }
            RequestReply::BusinessTool { success, text } => {
                json!({"success":success,"contentItems":[{"type":"inputText","text":text}]})
            }
        };
        self.write_wire(&json!({"id":pending.native_id,"result":result}))
    }

    pub fn replay(&self, epoch: u64, after_sequence: u64, limit: usize) -> HostResult<Replay> {
        self.check_epoch(epoch)?;
        if limit == 0 || limit > EVENT_CAPACITY {
            return Err(HostError::new(
                "invalid_argument",
                "Invalid Codex replay limit",
            ));
        }
        let shared = self.shared.lock().unwrap();
        if let Some(journal) = &shared.journal {
            return journal.replay(epoch, after_sequence, limit);
        }
        let gap = shared
            .events
            .front()
            .is_some_and(|first| after_sequence < first.sequence.saturating_sub(1));
        let events = shared
            .events
            .iter()
            .filter(|event| event.epoch == epoch && event.sequence > after_sequence)
            .take(limit)
            .cloned()
            .collect();
        Ok(Replay {
            events,
            latest_sequence: shared.sequence,
            gap,
        })
    }

    pub fn ack_events(&self, epoch: u64, sequence: u64) -> HostResult<()> {
        self.check_epoch(epoch)?;
        let mut shared = self.shared.lock().unwrap();
        if let Some(journal) = shared.journal.as_mut() {
            journal.ack(epoch, sequence)?;
        }
        Ok(())
    }

    pub fn disconnect(&self) {
        let _lifecycle = self.lifecycle.lock().unwrap();
        self.disconnect_inner();
    }

    fn disconnect_inner(&self) {
        let process = self.process.lock().unwrap().take();
        if let Some(mut process) = process {
            self.invalidate("Codex disconnected");
            process.stdin.lock().unwrap().take();
            let deadline = Instant::now() + EXIT_GRACE;
            while Instant::now() < deadline {
                if process.child.try_wait().ok().flatten().is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            if process.child.try_wait().ok().flatten().is_none() {
                process.job.terminate();
            }
            let _ = process.child.wait();
            if let Some(thread) = process.stdout_thread.take() {
                let _ = thread.join();
            }
            if let Some(thread) = process.stderr_thread.take() {
                let _ = thread.join();
            }
        }
        *self.connection.lock().unwrap() = None;
        *self.login_id.lock().unwrap() = None;
    }

    pub fn disconnect_if_epoch(&self, epoch: u64) -> HostResult<()> {
        let _lifecycle = self.lifecycle.lock().unwrap();
        if self.shared.lock().unwrap().epoch != epoch {
            return Err(HostError::new("stale_epoch", "Codex session epoch changed"));
        }
        self.disconnect_inner();
        Ok(())
    }

    fn invalidate(&self, message: &str) {
        let pending = {
            let mut shared = self.shared.lock().unwrap();
            shared.running = false;
            shared.allowed_threads.clear();
            shared.thread_tools.clear();
            shared.active_turns.clear();
            shared.pending_requests.clear();
            std::mem::take(&mut shared.pending_rpc)
        };
        for (_, tx) in pending {
            let _ = tx.send(Err(HostError::new("transport_closed", message)));
        }
    }

    fn record(&self, event: HostEventKind) {
        let epoch = self.shared.lock().unwrap().epoch;
        record(&self.shared, &self.emit, epoch, event);
    }
}

impl Drop for CodexHost {
    fn drop(&mut self) {
        self.disconnect();
    }
}

fn validated_image_input(url: &str) -> HostResult<(Value, usize)> {
    let invalid = || HostError::new("invalid_argument", "Unsupported or invalid Codex image");
    let (media, encoded) = url.split_once(";base64,").ok_or_else(invalid)?;
    if !matches!(
        media,
        "data:image/png" | "data:image/jpeg" | "data:image/webp" | "data:image/gif"
    ) || encoded.len() > MAX_IMAGE_BYTES * 4 / 3 + 8
    {
        return Err(invalid());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| invalid())?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(invalid());
    }
    let signature_ok = match media {
        "data:image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "data:image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "data:image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "data:image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    };
    if !signature_ok {
        return Err(invalid());
    }
    Ok((json!({"type":"image","url":url}), bytes.len()))
}

fn canonical_directory(raw: &str) -> HostResult<std::path::PathBuf> {
    let path = Path::new(raw);
    if !path.is_absolute() || !path.is_dir() {
        return Err(HostError::new(
            "invalid_argument",
            "Workspace root must be an existing absolute directory",
        ));
    }
    path.canonicalize()
        .map_err(|_| HostError::new("invalid_argument", "Could not resolve workspace root"))
}

fn root_overlaps_protected(root: &Path, protected: &Path) -> HostResult<bool> {
    if !protected.is_absolute() {
        return Err(HostError::new(
            "invalid_argument",
            "Protected application path is not absolute",
        ));
    }
    let mut ancestor = protected.to_path_buf();
    let mut suffix = Vec::new();
    while !ancestor.exists() {
        let name = ancestor.file_name().ok_or_else(|| {
            HostError::new(
                "invalid_argument",
                "Could not resolve protected application path",
            )
        })?;
        suffix.push(name.to_owned());
        ancestor = ancestor
            .parent()
            .ok_or_else(|| {
                HostError::new(
                    "invalid_argument",
                    "Could not resolve protected application path",
                )
            })?
            .to_path_buf();
    }
    let mut resolved = ancestor.canonicalize().map_err(|_| {
        HostError::new(
            "invalid_argument",
            "Could not resolve protected application path",
        )
    })?;
    for name in suffix.iter().rev() {
        resolved.push(name);
    }
    Ok(resolved.starts_with(root) || root.starts_with(&resolved))
}

fn validate_id(id: &str) -> HostResult<()> {
    if id.is_empty() || id.len() > 256 || id.chars().any(char::is_control) {
        Err(HostError::new(
            "invalid_argument",
            "Invalid Codex identifier",
        ))
    } else {
        Ok(())
    }
}

fn validate_optional_id(id: Option<&str>) -> HostResult<()> {
    if let Some(id) = id {
        validate_id(id)?;
    }
    Ok(())
}

const KNOWN_BUSINESS_TOOLS: &[&str] = &[
    "tabs_document_read_v1",
    "tabs_documents_list_v1",
    "tabs_document_replace_selection_v1",
    "tabs_document_create_v1",
    "tabs_document_export_v1",
    "tabs_tasks_list_v1",
    "tabs_tasks_create_v1",
    "tabs_tasks_update_v1",
    "tabs_tasks_comment_v1",
    "tabs_tasks_soft_delete_v1",
    "tabs_crm_read_v1",
    "tabs_crm_create_contact_v1",
    "tabs_crm_create_company_v1",
    "tabs_crm_create_deal_v1",
    "tabs_crm_update_v1",
    "tabs_crm_add_note_v1",
    "tabs_crm_link_task_v1",
    "tabs_forms_read_v1",
    "tabs_forms_create_draft_v1",
    "tabs_forms_update_draft_v1",
    "tabs_forms_follow_up_task_v1",
    "tabs_settings_read_v1",
    "tabs_settings_update_v1",
];

fn validate_tools(tools: &[ToolSpec]) -> HostResult<()> {
    if tools.len() > KNOWN_BUSINESS_TOOLS.len() {
        return Err(HostError::new(
            "invalid_argument",
            "Too many Codex business tools",
        ));
    }
    let mut seen = HashSet::new();
    for tool in tools {
        if !KNOWN_BUSINESS_TOOLS.contains(&tool.name.as_str())
            || !seen.insert(tool.name.as_str())
            || tool.description.is_empty()
            || tool.description.len() > 4096
            || !tool.input_schema.is_object()
            || serde_json::to_vec(&tool.input_schema).is_ok_and(|bytes| bytes.len() > 64 * 1024)
        {
            return Err(HostError::new(
                "invalid_argument",
                "Invalid Codex business tool",
            ));
        }
    }
    Ok(())
}

fn write_wire(stdin: &Arc<Mutex<Option<ChildStdin>>>, value: &Value) -> HostResult<()> {
    let mut bytes = serde_json::to_vec(value)
        .map_err(|_| HostError::new("invalid_argument", "Could not encode Codex message"))?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(HostError::new(
            "invalid_argument",
            "Codex message exceeds limit",
        ));
    }
    bytes.push(b'\n');
    let mut guard = stdin.lock().unwrap();
    let writer = guard
        .as_mut()
        .ok_or_else(|| HostError::new("transport_closed", "Codex input is closed"))?;
    writer
        .write_all(&bytes)
        .and_then(|_| writer.flush())
        .map_err(|_| HostError::new("transport_closed", "Could not write to Codex"))
}

fn record(
    shared: &Arc<Mutex<Shared>>,
    emit: &Arc<dyn Fn(HostEvent) + Send + Sync>,
    epoch: u64,
    event: HostEventKind,
) {
    let recorded = {
        let mut shared = shared.lock().unwrap();
        if shared.epoch != epoch || shared.journal_fault {
            return;
        }
        shared.sequence += 1;
        let event = HostEvent {
            epoch,
            sequence: shared.sequence,
            event,
        };
        let recorded = if shared
            .journal
            .as_mut()
            .is_some_and(|journal| journal.append(&event).is_err())
        {
            shared.journal_fault = true;
            shared.running = false;
            HostEvent {
                epoch,
                sequence: shared.sequence,
                event: HostEventKind::Status {
                    status: "failed".into(),
                    message: Some(
                        "Codex event journal is unavailable; AI execution is stopped".into(),
                    ),
                },
            }
        } else {
            event
        };
        shared.events.push_back(recorded.clone());
        while shared.events.len() > EVENT_CAPACITY {
            shared.events.pop_front();
        }
        recorded
    };
    emit(recorded);
}

fn read_stdout(
    mut stdout: impl Read,
    epoch: u64,
    shared: Arc<Mutex<Shared>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    job: Arc<OwnedJob>,
    emit: Arc<dyn Fn(HostEvent) + Send + Sync>,
) {
    let mut decoder = JsonlDecoder::new();
    let mut bytes = [0u8; 8192];
    let mut failure = None;
    'reader: loop {
        match stdout.read(&mut bytes) {
            Ok(0) => {
                if let Err(error) = decoder.finish() {
                    failure = Some(error.message);
                }
                break;
            }
            Ok(n) => match decoder.push(&bytes[..n]) {
                Ok(messages) => {
                    for message in messages {
                        handle_message(message, epoch, &shared, &stdin, &emit);
                        if shared.lock().unwrap().journal_fault {
                            failure = Some("Codex event journal is unavailable".into());
                            break 'reader;
                        }
                    }
                }
                Err(error) => {
                    failure = Some(error.message);
                    break;
                }
            },
            Err(_) => {
                failure = Some("Could not read Codex output".into());
                break;
            }
        }
    }
    if failure.is_some() {
        job.terminate();
    }
    let pending = {
        let mut shared = shared.lock().unwrap();
        if shared.epoch != epoch {
            return;
        }
        shared.running = false;
        shared.allowed_threads.clear();
        shared.pending_requests.clear();
        std::mem::take(&mut shared.pending_rpc)
    };
    for (_, tx) in pending {
        let _ = tx.send(Err(HostError::new(
            "transport_closed",
            "Codex process exited",
        )));
    }
    record(
        &shared,
        &emit,
        epoch,
        HostEventKind::Status {
            status: if failure.is_some() {
                "failed"
            } else {
                "closed"
            }
            .into(),
            message: failure,
        },
    );
}

fn read_stderr(
    mut stderr: impl Read,
    epoch: u64,
    shared: Arc<Mutex<Shared>>,
    emit: Arc<dyn Fn(HostEvent) + Send + Sync>,
) {
    let mut bytes = [0u8; 4096];
    let mut count = 0usize;
    while let Ok(n) = stderr.read(&mut bytes) {
        if n == 0 {
            break;
        }
        count = count.saturating_add(n);
    }
    if count > 0 {
        record(
            &shared,
            &emit,
            epoch,
            HostEventKind::Diagnostic {
                message: format!("Codex wrote {count} stderr bytes; contents withheld"),
            },
        );
    }
}

fn handle_message(
    message: Value,
    epoch: u64,
    shared: &Arc<Mutex<Shared>>,
    stdin: &Arc<Mutex<Option<ChildStdin>>>,
    emit: &Arc<dyn Fn(HostEvent) + Send + Sync>,
) {
    let id = message.get("id");
    let method = message.get("method").and_then(Value::as_str);
    if let (Some(id), None) = (id, method) {
        if let Some(id) = id.as_u64() {
            let sender = shared.lock().unwrap().pending_rpc.remove(&id);
            if let Some(sender) = sender {
                let result = if let Some(error) = message.get("error") {
                    Err(HostError::new(
                        "protocol_error",
                        format!(
                            "Codex RPC failed: {}",
                            error.get("code").and_then(Value::as_i64).unwrap_or(0)
                        ),
                    ))
                } else {
                    message
                        .get("result")
                        .cloned()
                        .ok_or_else(|| HostError::new("protocol_error", "Codex RPC has no result"))
                };
                let _ = sender.send(result);
            }
        }
        return;
    }
    let Some(method) = method else {
        record(
            shared,
            emit,
            epoch,
            HostEventKind::Diagnostic {
                message: "Codex sent an unrecognized frame".into(),
            },
        );
        return;
    };
    if let Some(native_id) = id {
        let kind = match method {
            "item/fileChange/requestApproval" => Some("fileChangeApproval"),
            "item/commandExecution/requestApproval"
            | "item/execCommand/requestApproval"
            | "item/applyPatch/requestApproval" => Some("commandApproval"),
            "item/tool/requestUserInput" => Some("question"),
            "item/tool/call" => Some("businessTool"),
            _ => None,
        };
        if let Some(kind) = kind {
            let params = message.get("params").unwrap_or(&Value::Null);
            let thread_id = params
                .get("threadId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let turn_id = params
                .get("turnId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if thread_id.is_empty() || turn_id.is_empty() {
                let _ = write_wire(
                    stdin,
                    &json!({"id":native_id,"error":{"code":-32602,"message":"Missing request correlation"}}),
                );
                return;
            }
            if !shared.lock().unwrap().allowed_threads.contains(thread_id) {
                let _ = write_wire(
                    stdin,
                    &json!({"id":native_id,"error":{"code":-32602,"message":"Request thread is not owned by TABS"}}),
                );
                return;
            }
            if kind == "businessTool" {
                let call_id = params
                    .get("callId")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let tool_name = params
                    .get("tool")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let permitted = {
                    let state = shared.lock().unwrap();
                    state
                        .thread_tools
                        .get(thread_id)
                        .is_some_and(|tools| tools.contains(tool_name))
                        && state
                            .active_turns
                            .get(thread_id)
                            .is_some_and(|turn| turn == turn_id)
                };
                if call_id.is_empty()
                    || call_id.len() > 256
                    || !permitted
                    || !params.get("arguments").is_some_and(Value::is_object)
                {
                    let _ = write_wire(
                        stdin,
                        &json!({"id":native_id,"error":{"code":-32601,"message":"Business tool is unavailable for this turn"}}),
                    );
                    return;
                }
            }
            let details = match kind {
                "fileChangeApproval" => {
                    json!({"reason":params.get("reason"),"grantRoot":params.get("grantRoot")})
                }
                "commandApproval" => {
                    json!({"reason":params.get("reason"),"command":params.get("command"),"cwd":params.get("cwd"),"availableDecisions":params.get("availableDecisions"),"additionalPermissions":params.get("additionalPermissions")})
                }
                "question" => json!({"questions":params.get("questions")}),
                "businessTool" => json!({"arguments":params.get("arguments")}),
                _ => Value::Null,
            };
            if serde_json::to_vec(&details).is_ok_and(|bytes| bytes.len() > MAX_TEXT_BYTES) {
                let _ = write_wire(
                    stdin,
                    &json!({"id":native_id,"error":{"code":-32602,"message":"Request details exceed limit"}}),
                );
                return;
            }
            let request_id = {
                let mut shared = shared.lock().unwrap();
                let request_id = format!("{}:{}", epoch, shared.next_request_id);
                shared.next_request_id += 1;
                shared.pending_requests.insert(
                    request_id.clone(),
                    ServerRequest {
                        native_id: native_id.clone(),
                        kind: kind.into(),
                        method: method.into(),
                        epoch,
                    },
                );
                request_id
            };
            record(
                shared,
                emit,
                epoch,
                HostEventKind::Request {
                    request: PendingRequestView {
                        request_id,
                        kind: kind.into(),
                        thread_id: thread_id.into(),
                        turn_id: turn_id.into(),
                        item_id: params
                            .get("itemId")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        call_id: params
                            .get("callId")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        tool_name: params
                            .get("tool")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        details,
                    },
                },
            );
        } else {
            let _ = write_wire(
                stdin,
                &json!({"id":native_id,"error":{"code":-32601,"message":"Unsupported Codex request"}}),
            );
            record(
                shared,
                emit,
                epoch,
                HostEventKind::Diagnostic {
                    message: format!("Unsupported Codex request: {}", bounded_method(method)),
                },
            );
        }
        return;
    }
    let params = message.get("params").unwrap_or(&Value::Null);
    match method {
        "item/started" | "item/completed" => {
            let item = params.get("item").unwrap_or(&Value::Null);
            let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
            let details = match item_type {
                "fileChange" => json!({"changes":item.get("changes")}),
                "commandExecution" => {
                    json!({"command":item.get("command"),"cwd":item.get("cwd"),"exitCode":item.get("exitCode")})
                }
                "dynamicToolCall" => json!({"tool":item.get("tool"),"success":item.get("success")}),
                "webSearch" => json!({"query":item.get("query")}),
                _ => return,
            };
            record_tool_activity(
                shared,
                emit,
                epoch,
                params,
                value_string(item, "id"),
                item_type,
                Some(if method == "item/started" {
                    "started"
                } else {
                    "completed"
                }),
                details,
            );
        }
        "item/fileChange/patchUpdated" => {
            record_tool_activity(
                shared,
                emit,
                epoch,
                params,
                value_string(params, "itemId"),
                "fileChange",
                Some("patchUpdated"),
                json!({"changes":params.get("changes")}),
            );
        }
        "item/commandExecution/outputDelta" => {
            record_tool_activity(
                shared,
                emit,
                epoch,
                params,
                value_string(params, "itemId"),
                "commandExecution",
                Some("outputDelta"),
                json!({"delta":params.get("delta")}),
            );
        }
        "item/agentMessage/delta" => {
            let delta = params
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if delta.len() <= MAX_TEXT_BYTES {
                record(
                    shared,
                    emit,
                    epoch,
                    HostEventKind::TextDelta {
                        thread_id: value_string(params, "threadId"),
                        turn_id: value_string(params, "turnId"),
                        item_id: value_string(params, "itemId"),
                        delta: delta.into(),
                    },
                );
            }
        }
        "turn/completed" | "turn/started" => {
            let thread_id = value_string(params, "threadId");
            let turn_id = params
                .pointer("/turn/id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            {
                let mut state = shared.lock().unwrap();
                if method == "turn/started" && state.allowed_threads.contains(&thread_id) {
                    state
                        .active_turns
                        .insert(thread_id.clone(), turn_id.clone());
                } else if method == "turn/completed"
                    && state
                        .active_turns
                        .get(&thread_id)
                        .is_some_and(|active| active == &turn_id)
                {
                    state.active_turns.remove(&thread_id);
                }
            }
            record(
                shared,
                emit,
                epoch,
                HostEventKind::TurnStatus {
                    thread_id,
                    turn_id,
                    status: params
                        .pointer("/turn/status")
                        .and_then(Value::as_str)
                        .unwrap_or(if method == "turn/started" {
                            "running"
                        } else {
                            "unknown"
                        })
                        .into(),
                },
            );
        }
        "serverRequest/resolved" => {
            if let Some(native_id) = params.get("requestId") {
                shared
                    .lock()
                    .unwrap()
                    .pending_requests
                    .retain(|_, pending| &pending.native_id != native_id);
            }
        }
        _ => record(
            shared,
            emit,
            epoch,
            HostEventKind::Diagnostic {
                message: format!("Codex notification: {}", bounded_method(method)),
            },
        ),
    }
}

fn value_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .take(256)
        .collect()
}

fn bounded_method(method: &str) -> String {
    method.chars().take(128).collect()
}

fn record_tool_activity(
    shared: &Arc<Mutex<Shared>>,
    emit: &Arc<dyn Fn(HostEvent) + Send + Sync>,
    epoch: u64,
    params: &Value,
    item_id: String,
    item_type: &str,
    status: Option<&str>,
    details: Value,
) {
    if serde_json::to_vec(&details).is_ok_and(|bytes| bytes.len() <= MAX_TEXT_BYTES) {
        record(
            shared,
            emit,
            epoch,
            HostEventKind::ToolActivity {
                thread_id: value_string(params, "threadId"),
                turn_id: value_string(params, "turnId"),
                item_id,
                item_type: item_type.into(),
                status: status.map(str::to_owned),
                details,
            },
        );
    } else {
        record(
            shared,
            emit,
            epoch,
            HostEventKind::Diagnostic {
                message: "Codex tool activity exceeds event size limit".into(),
            },
        );
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn image_input_accepts_bounded_png_and_rejects_mismatched_content() {
        let image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRRkAAAAASUVORK5CYII=";
        let (item, bytes) = validated_image_input(image).unwrap();
        assert_eq!(item["type"], "image");
        assert!(bytes > 8);
        assert!(validated_image_input("data:image/png;base64,bm90IGFuIGltYWdl").is_err());
        assert!(validated_image_input("data:image/svg+xml;base64,PHN2Zz4=").is_err());
    }

    fn fixture_launch(mode: &str, child_pid_file: Option<&Path>) -> Launch {
        let script =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("src/codex/fixtures/fake_app_server.mjs");
        let mut prefix = vec![script.into_os_string(), mode.into()];
        if let Some(path) = child_pid_file {
            prefix.push(path.as_os_str().to_owned());
        }
        Launch {
            executable: "node.exe".into(),
            prefix,
            display_path: "node.exe".into(),
        }
    }

    #[test]
    fn fake_round_trip_fragmented_delta_and_approval() {
        let temp = tempfile::tempdir().unwrap();
        let host = CodexHost::new(|_| {});
        host.spawn(&fixture_launch("normal", None), temp.path(), &[])
            .unwrap();
        host.handshake().unwrap();
        let epoch = host.shared.lock().unwrap().epoch;
        let models = host.list_models(epoch).unwrap();
        assert_eq!(models[0].id, "fake-model");
        assert_eq!(models[0].reasoning_efforts, vec!["low", "high"]);
        let thread_id = host
            .start_thread(ThreadRequest {
                epoch,
                workspace_root: temp.path().to_string_lossy().into_owned(),
                permission_profile: PermissionProfile::ReadOnly,
                approval_policy: ApprovalPolicy::OnRequest,
                model: None,
                tools: vec![],
            })
            .unwrap();
        assert_eq!(thread_id, "fake-thread");
        let turn_id = host
            .start_turn(TurnRequest {
                epoch,
                thread_id,
                text: "synthetic".into(),
                images: vec![],
                model: None,
                effort: None,
            })
            .unwrap();
        assert_eq!(turn_id, "fake-turn");
        let deadline = Instant::now() + Duration::from_secs(3);
        let request_id = loop {
            let replay = host.replay(epoch, 0, 1024).unwrap();
            if let Some(request_id) = replay.events.iter().find_map(|event| match &event.event {
                HostEventKind::Request { request } => Some(request.request_id.clone()),
                _ => None,
            }) {
                break request_id;
            }
            assert!(Instant::now() < deadline, "approval request missing");
            std::thread::sleep(Duration::from_millis(10));
        };
        host.reply_request(
            epoch,
            &request_id,
            RequestReply::FileChangeApproval {
                decision: protocol::ApprovalDecision::Decline,
            },
        )
        .unwrap();
        assert_eq!(
            host.reply_request(
                epoch,
                &request_id,
                RequestReply::FileChangeApproval {
                    decision: protocol::ApprovalDecision::Decline
                }
            )
            .unwrap_err()
            .code,
            "stale_request"
        );
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let replay = host.replay(epoch, 0, 1024).unwrap();
            let delta = replay.events.iter().any(|event| matches!(&event.event, HostEventKind::TextDelta { delta, .. } if delta == "café"));
            let patch = replay.events.iter().any(|event| {
                matches!(&event.event,
                HostEventKind::ToolActivity { item_id, status, .. }
                    if item_id == "fake-change" && status.as_deref() == Some("patchUpdated"))
            });
            let complete = replay.events.iter().any(|event| matches!(&event.event, HostEventKind::TurnStatus { status, .. } if status == "completed"));
            if delta && patch && complete {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "fragmented delta, patch, or terminal event missing"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        host.disconnect_if_epoch(epoch).unwrap();
        assert!(host.status().is_none());
    }

    #[test]
    fn malformed_oversized_eof_timeout_and_stderr() {
        let temp = tempfile::tempdir().unwrap();
        for mode in ["malformed", "oversized", "eof", "timeout"] {
            let host = CodexHost::new(|_| {});
            host.spawn(&fixture_launch(mode, None), temp.path(), &[])
                .unwrap();
            let result = host.rpc("initialize", json!({}), Duration::from_millis(500));
            assert!(result.is_err(), "{mode} unexpectedly succeeded");
            host.disconnect();
        }
        let host = CodexHost::new(|_| {});
        host.spawn(&fixture_launch("stderr", None), temp.path(), &[])
            .unwrap();
        host.handshake().unwrap();
        host.disconnect();
        let shared = host.shared.lock().unwrap();
        assert!(shared.events.iter().any(|event| matches!(&event.event,
            HostEventKind::Diagnostic { message } if message.contains("stderr bytes; contents withheld"))));
    }

    #[test]
    fn unknown_and_unadvertised_business_requests_fail_closed() {
        let temp = tempfile::tempdir().unwrap();
        let host = CodexHost::new(|_| {});
        host.spawn(&fixture_launch("unknown-request", None), temp.path(), &[])
            .unwrap();
        host.handshake().unwrap();
        let epoch = host.shared.lock().unwrap().epoch;
        let thread_id = host
            .start_thread(ThreadRequest {
                epoch,
                workspace_root: temp.path().to_string_lossy().into_owned(),
                permission_profile: PermissionProfile::ReadOnly,
                approval_policy: ApprovalPolicy::OnRequest,
                model: None,
                tools: vec![],
            })
            .unwrap();
        host.start_turn(TurnRequest {
            epoch,
            thread_id,
            text: "synthetic".into(),
            images: vec![],
            model: None,
            effort: None,
        })
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let replay = host.replay(epoch, 0, 1024).unwrap();
            let deltas: Vec<_> = replay
                .events
                .iter()
                .filter_map(|event| match &event.event {
                    HostEventKind::TextDelta { delta, .. } => Some(delta.as_str()),
                    _ => None,
                })
                .collect();
            if deltas.contains(&"rejected-701") && deltas.contains(&"rejected-702") {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "unknown request was not rejected"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(host.shared.lock().unwrap().pending_requests.is_empty());
        host.disconnect_if_epoch(epoch).unwrap();
    }

    #[test]
    fn advertised_business_request_is_correlated_and_answered_once() {
        let temp = tempfile::tempdir().unwrap();
        let host = CodexHost::new(|_| {});
        host.spawn(&fixture_launch("business", None), temp.path(), &[])
            .unwrap();
        host.handshake().unwrap();
        let epoch = host.shared.lock().unwrap().epoch;
        let thread_id = host
            .start_thread(ThreadRequest {
                epoch,
                workspace_root: temp.path().to_string_lossy().into_owned(),
                permission_profile: PermissionProfile::ReadOnly,
                approval_policy: ApprovalPolicy::OnRequest,
                model: None,
                tools: vec![ToolSpec {
                    name: "tabs_tasks_list_v1".into(),
                    description: "Read synthetic tasks".into(),
                    input_schema: json!({"type":"object","properties":{}}),
                }],
            })
            .unwrap();
        let turn_id = host
            .start_turn(TurnRequest {
                epoch,
                thread_id: thread_id.clone(),
                text: "synthetic".into(),
                images: vec![],
                model: None,
                effort: None,
            })
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        let request = loop {
            let replay = host.replay(epoch, 0, 1024).unwrap();
            if let Some(request) = replay.events.iter().find_map(|event| match &event.event {
                HostEventKind::Request { request } if request.kind == "businessTool" => {
                    Some(request.clone())
                }
                _ => None,
            }) {
                break request;
            }
            assert!(Instant::now() < deadline, "business request missing");
            std::thread::sleep(Duration::from_millis(10));
        };
        assert_eq!(request.thread_id, thread_id);
        assert_eq!(request.turn_id, turn_id);
        assert_eq!(request.call_id.as_deref(), Some("fake-business-call"));
        assert_eq!(request.tool_name.as_deref(), Some("tabs_tasks_list_v1"));
        host.reply_request(
            epoch,
            &request.request_id,
            RequestReply::BusinessTool {
                success: true,
                text: "synthetic result".into(),
            },
        )
        .unwrap();
        assert_eq!(
            host.reply_request(
                epoch,
                &request.request_id,
                RequestReply::BusinessTool {
                    success: true,
                    text: "duplicate".into(),
                },
            )
            .unwrap_err()
            .code,
            "stale_request"
        );
        loop {
            let replay = host.replay(epoch, 0, 1024).unwrap();
            if replay.events.iter().any(|event| {
                matches!(&event.event,
                HostEventKind::TextDelta { delta, .. } if delta == "business-applied")
            }) {
                break;
            }
            assert!(Instant::now() < deadline, "business reply missing");
            std::thread::sleep(Duration::from_millis(10));
        }
        let turns = host.read_thread(epoch, &thread_id).unwrap();
        assert_eq!(turns[0].assistant_items[0].text, "business-applied");
        host.disconnect_if_epoch(epoch).unwrap();
    }

    #[test]
    fn missing_binary_is_actionable() {
        let missing = Path::new(env!("CARGO_MANIFEST_DIR")).join("missing-codex.exe");
        assert_eq!(
            CodexHost::discover(Some(missing.to_str().unwrap()))
                .unwrap_err()
                .code,
            "not_found"
        );
    }

    #[test]
    fn writable_root_cannot_overlap_application_data() {
        let temp = tempfile::tempdir().unwrap();
        let protected = temp.path().join("application-data");
        std::fs::create_dir_all(&protected).unwrap();
        let host = CodexHost::new(|_| {}).with_protected_roots(vec![protected.clone()]);
        host.spawn(&fixture_launch("normal", None), temp.path(), &[])
            .unwrap();
        host.handshake().unwrap();
        let epoch = host.shared.lock().unwrap().epoch;
        let root = temp.path().to_string_lossy().into_owned();
        let rejected = host.start_thread(ThreadRequest {
            epoch,
            workspace_root: root.clone(),
            permission_profile: PermissionProfile::WorkspaceWrite,
            approval_policy: ApprovalPolicy::OnRequest,
            model: None,
            tools: vec![],
        });
        assert_eq!(rejected.unwrap_err().code, "invalid_argument");
        let allowed = host.start_thread(ThreadRequest {
            epoch,
            workspace_root: root,
            permission_profile: PermissionProfile::ReadOnly,
            approval_policy: ApprovalPolicy::OnRequest,
            model: None,
            tools: vec![],
        });
        assert_eq!(allowed.unwrap(), "fake-thread");
        host.disconnect_if_epoch(epoch).unwrap();
    }

    #[test]
    fn owned_job_closes_descendant_with_unicode_space_path() {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_TERMINATE,
        };
        let temp = tempfile::tempdir().unwrap();
        let unicode_dir = temp.path().join("synthetic ünicode space");
        std::fs::create_dir_all(&unicode_dir).unwrap();
        let script = unicode_dir.join("fake app server.mjs");
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("src/codex/fixtures/fake_app_server.mjs"),
            &script,
        )
        .unwrap();
        let pid_file = unicode_dir.join("child pid.txt");
        let launch = Launch {
            executable: "node.exe".into(),
            prefix: vec![
                script.into_os_string(),
                "normal".into(),
                pid_file.as_os_str().to_owned(),
            ],
            display_path: "node.exe".into(),
        };
        let host = CodexHost::new(|_| {});
        host.spawn(&launch, &unicode_dir, &[]).unwrap();
        host.handshake().unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while !pid_file.is_file() {
            assert!(
                Instant::now() < deadline,
                "fixture descendant did not start"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        let pid: u32 = std::fs::read_to_string(&pid_file).unwrap().parse().unwrap();
        let active = |pid| {
            let handle = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
                    0,
                    pid,
                )
            };
            if handle.is_null() {
                return false;
            }
            let mut exit_code = 0;
            let running =
                unsafe { GetExitCodeProcess(handle, &mut exit_code) != 0 && exit_code == 259 };
            unsafe { CloseHandle(handle) };
            running
        };
        assert!(active(pid), "fixture descendant exited before cleanup");
        host.disconnect();
        let deadline = Instant::now() + Duration::from_secs(2);
        while active(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        if active(pid) {
            let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
            if !handle.is_null() {
                unsafe {
                    TerminateProcess(handle, 1);
                    CloseHandle(handle);
                }
            }
            panic!("TABS-owned descendant survived host disconnect");
        }
    }

    #[test]
    #[ignore = "requires installed Codex 0.155.1 and ChatGPT sign-in"]
    fn installed_connect_and_models() {
        let temp = tempfile::tempdir().unwrap();
        let host = CodexHost::new(|_| {});
        let connection = host.connect(None, temp.path().to_str().unwrap()).unwrap();
        assert_eq!(connection.version, "codex-cli 0.155.1");
        let models = host.list_models(connection.epoch).unwrap();
        assert!(!models.is_empty());
        assert!(models
            .iter()
            .any(|model| !model.reasoning_efforts.is_empty()));
        host.disconnect_if_epoch(connection.epoch).unwrap();
    }

    #[test]
    #[ignore = "uses installed Codex 0.155.1 and a synthetic ChatGPT model turn"]
    fn installed_two_turns_with_native_resume() {
        let temp = tempfile::tempdir().unwrap();
        let host = CodexHost::new(|_| {});
        let connection = host.connect(None, temp.path().to_str().unwrap()).unwrap();
        let models = host.list_models(connection.epoch).unwrap();
        let chosen = models
            .iter()
            .find(|model| model.id == "gpt-6-luna")
            .or_else(|| models.iter().find(|model| model.is_default))
            .unwrap();
        let thread_id = host
            .start_thread(ThreadRequest {
                epoch: connection.epoch,
                workspace_root: temp.path().to_string_lossy().into_owned(),
                permission_profile: PermissionProfile::ReadOnly,
                approval_policy: ApprovalPolicy::Never,
                model: Some(chosen.id.clone()),
                tools: vec![],
            })
            .unwrap();
        let run_turn = |host: &CodexHost, epoch, text: &str| {
            let turn_id = host
                .start_turn(TurnRequest {
                    epoch,
                    thread_id: thread_id.clone(),
                    text: text.into(),
                    images: vec![],
                    model: Some(chosen.id.clone()),
                    effort: Some("low".into()),
                })
                .unwrap();
            let deadline = Instant::now() + Duration::from_secs(120);
            loop {
                let replay = host.replay(epoch, 0, 1024).unwrap();
                if replay.events.iter().any(|event| {
                    matches!(&event.event,
                    HostEventKind::TurnStatus { turn_id: id, status, .. }
                        if id == &turn_id && status == "completed")
                }) {
                    return replay
                        .events
                        .iter()
                        .filter_map(|event| match &event.event {
                            HostEventKind::TextDelta {
                                turn_id: id, delta, ..
                            } if id == &turn_id => Some(delta.as_str()),
                            _ => None,
                        })
                        .collect::<String>();
                }
                assert!(
                    Instant::now() < deadline,
                    "installed Codex turn did not complete"
                );
                std::thread::sleep(Duration::from_millis(100));
            }
        };
        let first = run_turn(&host, connection.epoch,
            "Synthetic TABS host test. Do not use tools. Reply with exactly P1-SYNTHETIC-CITRON-920.");
        assert!(first.contains("P1-SYNTHETIC-CITRON-920"));
        host.disconnect_if_epoch(connection.epoch).unwrap();
        let resumed = host.connect(None, temp.path().to_str().unwrap()).unwrap();
        assert_eq!(
            host.resume_thread(resumed.epoch, &thread_id, vec![])
                .unwrap(),
            thread_id
        );
        let second = run_turn(&host, resumed.epoch,
            "Synthetic TABS host test after native resume. Do not use tools. Reply with exactly P1-RESUMED-LIME-284.");
        assert!(second.contains("P1-RESUMED-LIME-284"));
        host.disconnect_if_epoch(resumed.epoch).unwrap();
    }
}
