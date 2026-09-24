use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::codex::{CliOwnedJob, HostError, HostResult};

use super::discovery::{cli_path, discover};
use super::CliModel;

const RUN_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_OUTPUT: usize = 2 * 1024 * 1024;
const MAX_FINAL_TEXT: usize = 128 * 1024;
const MAX_PROMPT: usize = 32 * 1024;

static OPEN_CODE_REASONING_EFFORTS: OnceLock<Mutex<HashMap<String, Vec<String>>>> = OnceLock::new();
static COMMAND_CODE_REASONING_EFFORTS: OnceLock<Mutex<HashMap<String, Vec<String>>>> =
    OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub run_id: String,
    pub provider_id: String,
    pub model_id: String,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    pub prompt: String,
    pub workspace_root: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub run_id: String,
    pub status: &'static str,
    pub text: String,
}

#[derive(Default)]
pub struct RunRegistry {
    active: Mutex<HashMap<String, Arc<RunControl>>>,
}

pub struct RunControl {
    cancelled: AtomicBool,
    job: Mutex<Option<Arc<CliOwnedJob>>>,
}

impl RunRegistry {
    pub fn begin(&self, run_id: &str) -> HostResult<Arc<RunControl>> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| HostError::new("internal", "CLI run registry is unavailable"))?;
        if active.contains_key(run_id) {
            return Err(HostError::new("conflict", "CLI run ID is already active"));
        }
        if active.len() >= 4 {
            return Err(HostError::new("conflict", "Too many CLI runs are active"));
        }
        let control = Arc::new(RunControl {
            cancelled: AtomicBool::new(false),
            job: Mutex::new(None),
        });
        active.insert(run_id.to_owned(), Arc::clone(&control));
        Ok(control)
    }

    pub fn finish(&self, run_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(run_id);
        }
    }

    pub fn stop(&self, run_id: &str) -> HostResult<bool> {
        let control = self
            .active
            .lock()
            .map_err(|_| HostError::new("internal", "CLI run registry is unavailable"))?
            .get(run_id)
            .cloned();
        let Some(control) = control else {
            return Ok(false);
        };
        control.cancelled.store(true, Ordering::SeqCst);
        if let Ok(job) = control.job.lock() {
            if let Some(job) = job.as_ref() {
                job.terminate();
            }
        }
        Ok(true)
    }
}

fn invalid(message: &'static str) -> HostError {
    HostError::new("invalid_argument", message)
}

/// Records variants from the most recent trusted OpenCode probe. Runs accept
/// only variants advertised for the selected model.
pub(super) fn remember_open_code_model_efforts(models: &[CliModel]) {
    remember_model_efforts(&OPEN_CODE_REASONING_EFFORTS, models);
}

/// Records Command Code model effort support from its trusted local registry.
pub(super) fn remember_command_code_model_efforts(models: &[CliModel]) {
    remember_model_efforts(&COMMAND_CODE_REASONING_EFFORTS, models);
}

fn remember_model_efforts(
    cache: &OnceLock<Mutex<HashMap<String, Vec<String>>>>,
    models: &[CliModel],
) {
    let efforts = models
        .iter()
        .filter(|model| !model.reasoning_efforts.is_empty())
        .map(|model| (model.id.clone(), model.reasoning_efforts.clone()))
        .collect();
    if let Ok(mut cached) = cache.get_or_init(|| Mutex::new(HashMap::new())).lock() {
        *cached = efforts;
    }
}

fn effort_was_advertised(
    cache: &OnceLock<Mutex<HashMap<String, Vec<String>>>>,
    model_id: &str,
    effort: &str,
) -> bool {
    cache
        .get()
        .and_then(|cached| cached.lock().ok())
        .and_then(|cached| cached.get(model_id).cloned())
        .is_some_and(|efforts| efforts.iter().any(|supported| supported == effort))
}

fn validate_reasoning_effort(request: &RunRequest) -> HostResult<()> {
    let Some(effort) = request.reasoning_effort.as_deref() else {
        return Ok(());
    };

    let supported = match request.provider_id.as_str() {
        "grok" if matches!(request.model_id.as_str(), "grok-4.7" | "grok-4.6") => {
            matches!(effort, "low" | "medium" | "high" | "xhigh")
        }
        "grok" if request.model_id == "grok-4.5" => {
            matches!(effort, "low" | "medium" | "high")
        }
        "grok" => false,
        "openCode" => {
            matches!(
                effort,
                "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
            ) && effort_was_advertised(&OPEN_CODE_REASONING_EFFORTS, &request.model_id, effort)
        }
        "commandCode" => {
            effort_was_advertised(&COMMAND_CODE_REASONING_EFFORTS, &request.model_id, effort)
        }
        _ => false,
    };

    if supported {
        Ok(())
    } else {
        Err(invalid(
            "The selected model does not support this reasoning effort",
        ))
    }
}

fn reasoning_arguments(request: &RunRequest) -> HostResult<Vec<&str>> {
    validate_reasoning_effort(request)?;
    match (
        request.provider_id.as_str(),
        request.reasoning_effort.as_deref(),
    ) {
        (_, None) => Ok(Vec::new()),
        ("grok", Some(effort)) => Ok(vec!["--reasoning-effort", effort]),
        ("openCode", Some(effort)) => Ok(vec!["--variant", effort]),
        ("commandCode", Some(effort)) => Ok(vec!["--effort", effort]),
        _ => Err(invalid(
            "The selected model does not support this reasoning effort",
        )),
    }
}

pub fn validate_request(request: &RunRequest) -> HostResult<()> {
    if !matches!(
        request.provider_id.as_str(),
        "grok" | "commandCode" | "openCode"
    ) {
        return Err(invalid("Unsupported CLI provider"));
    }
    if request.run_id.len() < 8
        || request.run_id.len() > 80
        || !request
            .run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(invalid("Invalid CLI run ID"));
    }
    if request.model_id.is_empty()
        || request.model_id.len() > 160
        || request.model_id.starts_with('-')
        || !request
            .model_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:/+-".contains(&byte))
        || request.model_id.starts_with("typesafe/jev")
    {
        return Err(invalid("Invalid CLI model"));
    }
    if request.prompt.trim().is_empty() || request.prompt.len() > MAX_PROMPT {
        return Err(invalid("CLI prompt is empty or too long"));
    }
    if request.provider_id != "commandCode" && request.prompt.len() > 16 * 1024 {
        return Err(invalid("CLI prompt is too long for this provider"));
    }
    validate_reasoning_effort(request)?;
    let path = Path::new(&request.workspace_root);
    if !path.is_absolute() || !path.is_dir() {
        return Err(invalid("Selected workspace folder is unavailable"));
    }
    Ok(())
}

fn completed_text(provider_id: &str, output: &str) -> Option<String> {
    match provider_id {
        "grok" => {
            let text = output.trim();
            (!text.is_empty()).then(|| text.to_owned())
        }
        "commandCode" => command_code_text(output),
        "openCode" => open_code_text(output),
        _ => None,
    }
}

fn command_code_text(output: &str) -> Option<String> {
    for line in output.lines().rev() {
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("result") {
            continue;
        }
        if value.get("subtype").and_then(Value::as_str) != Some("success") {
            return None;
        }
        let text = value
            .get("finalText")
            .or_else(|| value.pointer("/result/finalText"))
            .and_then(Value::as_str)?;
        if !text.trim().is_empty() {
            return Some(text.trim().to_owned());
        }
    }
    None
}

fn open_code_text(output: &str) -> Option<String> {
    let mut text = String::new();
    for line in output.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("text") {
            continue;
        }
        if let Some(part) = value.pointer("/part/text").and_then(Value::as_str) {
            text.push_str(part);
        }
    }
    (!text.trim().is_empty()).then(|| text.trim().to_owned())
}

fn run_error(message: &'static str) -> HostError {
    HostError::new("cli_run_failed", message)
}

pub fn run(request: RunRequest, control: Arc<RunControl>) -> HostResult<RunResult> {
    let run_id = request.run_id.clone();
    let stopped = || RunResult {
        run_id: run_id.clone(),
        status: "stopped",
        text: String::new(),
    };
    if control.cancelled.load(Ordering::SeqCst) {
        return Ok(stopped());
    }
    let launch = discover(&request.provider_id)
        .map_err(|_| run_error("The selected CLI is unavailable. Check its installation."))?;
    let workspace = Path::new(&request.workspace_root)
        .canonicalize()
        .map_err(|_| invalid("Selected workspace folder is unavailable"))?;
    if !workspace.is_dir() {
        return Err(invalid("Selected workspace folder is unavailable"));
    }
    let workspace_text = cli_path(&workspace);
    let reasoning_args = reasoning_arguments(&request)?;
    let mut command = Command::new(&launch.executable);
    command.args(&launch.arguments).current_dir(&workspace);
    match request.provider_id.as_str() {
        "grok" => {
            command
                .args([
                    "--no-auto-update",
                    "--permission-mode",
                    "plan",
                    "--disable-web-search",
                    "--output-format",
                    "plain",
                    "--max-turns",
                    "8",
                    "-m",
                    &request.model_id,
                ])
                .args(&reasoning_args)
                .args(["--cwd", &workspace_text, "-p", &request.prompt]);
        }
        "commandCode" => {
            command
                .args([
                    "--no-auto-update",
                    "--skip-onboarding",
                    "--no-session",
                    "-p",
                    "--permission-mode",
                    "plan",
                    "--output-format",
                    "json",
                    "--max-turns",
                    "8",
                    "-m",
                    &request.model_id,
                ])
                .args(&reasoning_args);
        }
        "openCode" => {
            command
                .args([
                    "run",
                    "--pure",
                    "--agent",
                    "plan",
                    "--format",
                    "json",
                    "-m",
                    &request.model_id,
                ])
                .args(&reasoning_args)
                .args(["--dir", &workspace_text, "--", &request.prompt]);
        }
        _ => return Err(invalid("Unsupported CLI provider")),
    }
    command
        .stdin(if request.provider_id == "commandCode" {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    if control.cancelled.load(Ordering::SeqCst) {
        return Ok(stopped());
    }
    let mut child = command
        .spawn()
        .map_err(|_| run_error("The selected CLI could not start."))?;
    let job = match CliOwnedJob::assign(&child) {
        Ok(job) => Arc::new(job),
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(run_error("The CLI process could not be supervised."));
        }
    };
    {
        let mut slot = control
            .job
            .lock()
            .map_err(|_| run_error("The CLI run could not be supervised."))?;
        *slot = Some(Arc::clone(&job));
        if control.cancelled.load(Ordering::SeqCst) {
            job.terminate();
        }
    }
    let writer = child.stdin.take().map(|mut stdin| {
        let prompt = request.prompt.into_bytes();
        thread::spawn(move || stdin.write_all(&prompt))
    });
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| run_error("CLI output is unavailable."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| run_error("CLI output is unavailable."))?;
    let output_exceeded = Arc::new(AtomicBool::new(false));
    let stdout_overflow = Arc::clone(&output_exceeded);
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.take(MAX_OUTPUT as u64 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > MAX_OUTPUT {
            stdout_overflow.store(true, Ordering::SeqCst);
        }
        Ok::<_, std::io::Error>(bytes)
    });
    let stderr_overflow = Arc::clone(&output_exceeded);
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.take(64 * 1024 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > 64 * 1024 {
            stderr_overflow.store(true, Ordering::SeqCst);
        }
        Ok::<_, std::io::Error>(bytes)
    });
    let deadline = Instant::now() + RUN_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if control.cancelled.load(Ordering::SeqCst) => {
                job.terminate();
                let _ = child.wait();
                break None;
            }
            Ok(None) if output_exceeded.load(Ordering::SeqCst) => {
                job.terminate();
                let _ = child.wait();
                break None;
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(30)),
            Ok(None) => {
                job.terminate();
                let _ = child.wait();
                break None;
            }
            Err(_) => {
                job.terminate();
                let _ = child.wait();
                break None;
            }
        }
    };
    if let Ok(mut slot) = control.job.lock() {
        slot.take();
    }
    drop(job);
    if let Some(writer) = writer {
        let _ = writer.join();
    }
    let output = stdout_reader.join().ok().and_then(Result::ok);
    let _ = stderr_reader.join();
    if control.cancelled.load(Ordering::SeqCst) {
        return Ok(stopped());
    }
    if output_exceeded.load(Ordering::SeqCst) {
        return Err(run_error("CLI response exceeded the output limit."));
    }
    let status = status.ok_or_else(|| HostError::new("timeout", "The CLI run timed out."))?;
    let output = output.ok_or_else(|| run_error("CLI output could not be read."))?;
    if output.len() > MAX_OUTPUT {
        return Err(run_error("CLI response exceeded the output limit."));
    }
    if !status.success() {
        return Err(run_error(
            "The CLI could not complete this request. Check its login and selected model.",
        ));
    }
    let output = String::from_utf8_lossy(&output);
    let text = completed_text(&request.provider_id, &output)
        .ok_or_else(|| run_error("The CLI returned no final response."))?;
    if text.len() > MAX_FINAL_TEXT {
        return Err(run_error("CLI final response exceeded the text limit."));
    }
    Ok(RunResult {
        run_id,
        status: "completed",
        text,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        command_code_text, open_code_text, reasoning_arguments,
        remember_command_code_model_efforts, remember_open_code_model_efforts, validate_request,
        CliModel, RunRequest,
    };

    fn request(provider_id: &str, model_id: &str, reasoning_effort: Option<&str>) -> RunRequest {
        RunRequest {
            run_id: "test-run-1".to_owned(),
            provider_id: provider_id.to_owned(),
            model_id: model_id.to_owned(),
            reasoning_effort: reasoning_effort.map(str::to_owned),
            prompt: "Reply with a short plan.".to_owned(),
            workspace_root: std::env::current_dir()
                .expect("test working directory")
                .display()
                .to_string(),
        }
    }

    fn remember_open_code_variants() {
        remember_open_code_model_efforts(&[CliModel {
            id: "openai/gpt-5".to_owned(),
            display_name: "GPT-5".to_owned(),
            is_default: false,
            reasoning_efforts: vec!["minimal".to_owned(), "max".to_owned()],
        }]);
    }

    fn remember_command_code_efforts() {
        remember_command_code_model_efforts(&[CliModel {
            id: "claude-sonnet".to_owned(),
            display_name: "Claude Sonnet".to_owned(),
            is_default: false,
            reasoning_efforts: vec!["low".to_owned(), "high".to_owned()],
        }]);
    }

    #[test]
    fn validates_reasoning_effort_for_the_selected_provider_and_model() {
        remember_open_code_variants();
        remember_command_code_efforts();
        assert!(validate_request(&request("grok", "grok-4.7", Some("xhigh"))).is_ok());
        assert!(validate_request(&request("grok", "grok-4.5", Some("xhigh"))).is_err());
        assert!(validate_request(&request("grok", "grok-4.4", Some("medium"))).is_err());
        assert!(validate_request(&request("openCode", "openai/gpt-5", Some("max"))).is_ok());
        assert!(validate_request(&request("openCode", "openai/gpt-5", Some("high"))).is_err());
        assert!(validate_request(&request("openCode", "openai/gpt-6", Some("max"))).is_err());
        assert!(validate_request(&request("commandCode", "claude-sonnet", Some("high"))).is_ok());
        assert!(
            validate_request(&request("commandCode", "claude-sonnet", Some("medium"))).is_err()
        );
        assert!(validate_request(&request("commandCode", "claude-opus", Some("high"))).is_err());
    }

    #[test]
    fn builds_reasoning_arguments_only_for_supported_cli_providers() {
        remember_open_code_variants();
        remember_command_code_efforts();
        assert_eq!(
            reasoning_arguments(&request("grok", "grok-4.6", Some("high"))).unwrap(),
            vec!["--reasoning-effort", "high"]
        );
        assert_eq!(
            reasoning_arguments(&request("openCode", "openai/gpt-5", Some("minimal"))).unwrap(),
            vec!["--variant", "minimal"]
        );
        assert_eq!(
            reasoning_arguments(&request("commandCode", "claude-sonnet", Some("high"))).unwrap(),
            vec!["--effort", "high"]
        );
        assert!(reasoning_arguments(&request("grok", "grok-4.7", None))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn extracts_only_command_code_final_result() {
        let fixture = "{\"type\":\"text\",\"text\":\"partial\"}\n{\"type\":\"result\",\"subtype\":\"success\",\"finalText\":\"Final answer\"}\n";
        assert_eq!(command_code_text(fixture).as_deref(), Some("Final answer"));
        assert_eq!(
            command_code_text(
                "{\"type\":\"result\",\"subtype\":\"max_turns\",\"finalText\":\"Partial answer\"}"
            ),
            None
        );
        assert_eq!(command_code_text("partial text"), None);
    }

    #[test]
    fn combines_only_opencode_text_parts() {
        let fixture = "{\"type\":\"step_start\"}\n{\"type\":\"text\",\"part\":{\"text\":\"Hello \"}}\n{\"type\":\"text\",\"part\":{\"text\":\"world\"}}\n";
        assert_eq!(open_code_text(fixture).as_deref(), Some("Hello world"));
        assert_eq!(open_code_text("plain text"), None);
    }
}
