//! Fixed SSH transport to the owner's task authority. No arbitrary host/path/command IPC.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

const MAX_BYTES: usize = 64 * 1024 * 1024;
const RESOLVE: &str = "atlas_paths=\"$(sh /home/admin/.hermes/skills/atlas/atlas-map/scripts/resolve.sh)\" && eval \"$atlas_paths\" && exec python3 -B \"$ATLAS_TOOLS/atlas-tasks/tasks.py\"";

fn remote_command() -> Result<String, String> {
    #[cfg(feature = "tasks-acceptance")]
    {
        let name = fixture_name()?;
        return Ok(format!("{RESOLVE} --root \"$HERMES_WORKSPACE/{name}\" rpc"));
    }
    #[cfg(not(feature = "tasks-acceptance"))]
    Ok(format!("{RESOLVE} --root \"$ATLAS_TASKS\" rpc"))
}

#[cfg(feature = "tasks-acceptance")]
pub fn fixture_name() -> Result<String, String> {
    let name = std::env::var("TABS_TASKS_FIXTURE").map_err(|_| "TASKS_FIXTURE_REQUIRED")?;
    if !name.starts_with("task-authority-acceptance-")
        || name.len() > 100
        || !name
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        return Err("TASKS_FIXTURE_INVALID".into());
    }
    Ok(name)
}

fn bounded_read(mut reader: impl Read, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "TASKS_CONNECTION")?;
    if bytes.len() > limit {
        return Err("TASKS_RESPONSE_TOO_LARGE".into());
    }
    Ok(bytes)
}

fn rpc(request: Value) -> Result<Value, String> {
    if request.get("schema").and_then(Value::as_u64) != Some(1)
        || !matches!(
            request.get("action").and_then(Value::as_str),
            Some("snapshot" | "bootstrap" | "sync")
        )
    {
        return Err("TASKS_PROTOCOL".into());
    }
    let body = serde_json::to_vec(&request).map_err(|_| "TASKS_PROTOCOL")?;
    if body.len() > MAX_BYTES {
        return Err("TASKS_REQUEST_TOO_LARGE".into());
    }
    #[cfg(windows)]
    let ssh = std::path::PathBuf::from(std::env::var_os("WINDIR").ok_or("TASKS_SSH_MISSING")?)
        .join("System32/OpenSSH/ssh.exe");
    #[cfg(not(windows))]
    let ssh = std::path::PathBuf::from("/usr/bin/ssh");
    let mut command = Command::new(ssh);
    command.args([
        "-C",
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        "ServerAliveInterval=10",
        "-o",
        "ServerAliveCountMax=1",
        "admin@atlas-vps",
        &remote_command()?,
    ]);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|_| "TASKS_SSH_MISSING")?;
    let mut input = child.stdin.take().ok_or("TASKS_CONNECTION")?;
    let output = child.stdout.take().ok_or("TASKS_CONNECTION")?;
    let errors = child.stderr.take().ok_or("TASKS_CONNECTION")?;
    let writer = thread::spawn(move || input.write_all(&body));
    let reader = thread::spawn(move || bounded_read(output, MAX_BYTES));
    let error_reader = thread::spawn(move || bounded_read(errors, 8192));
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "TASKS_CONNECTION")? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(90) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = writer.join();
            let _ = reader.join();
            let _ = error_reader.join();
            return Err("TASKS_TIMEOUT".into());
        }
        thread::sleep(Duration::from_millis(30));
    };
    let _ = writer.join();
    let bytes = reader.join().map_err(|_| "TASKS_CONNECTION")??;
    // Deliberately never return arbitrary SSH diagnostic output to the renderer.
    let _ = error_reader.join();
    let result: Value = serde_json::from_slice(&bytes).map_err(|_| "TASKS_CONNECTION")?;
    if !status.success() || result.get("error").is_some() {
        let reason = result.get("error").and_then(Value::as_str).unwrap_or("");
        let code = if reason.contains("already initialized") {
            "TASKS_ALREADY_INITIALIZED"
        } else if reason.contains("identity changed") {
            "TASKS_AUTHORITY_CHANGED"
        } else if reason.contains("transport limit") {
            "TASKS_REQUEST_TOO_LARGE"
        } else {
            "TASKS_SERVER_REJECTED"
        };
        return Err(code.into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn task_authority_rpc(request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || rpc(request))
        .await
        .map_err(|_| "TASKS_CONNECTION")?
}

#[tauri::command]
pub fn task_authority_backup(app: tauri::AppHandle, records: Value) -> Result<Value, String> {
    let rows = records.as_array().ok_or("TASKS_PROTOCOL")?;
    if rows.iter().any(|r| {
        !matches!(
            r.get("table").and_then(Value::as_str),
            Some("clients" | "projects" | "tasks" | "taskComments")
        )
    }) {
        return Err("TASKS_PROTOCOL".into());
    }
    let bytes =
        serde_json::to_vec(&json!({"schema":1,"records":rows})).map_err(|_| "TASKS_PROTOCOL")?;
    if bytes.len() > MAX_BYTES {
        return Err("TASKS_REQUEST_TOO_LARGE".into());
    }
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "TASKS_BACKUP_FAILED")?
        .join("task-migration-backups");
    fs::create_dir_all(&folder).map_err(|_| "TASKS_BACKUP_FAILED")?;
    if fs::symlink_metadata(&folder)
        .map_err(|_| "TASKS_BACKUP_FAILED")?
        .file_type()
        .is_symlink()
    {
        return Err("TASKS_BACKUP_FAILED".into());
    }
    let path = folder.join(format!("{digest}.json"));
    if !path.exists() {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "TASKS_BACKUP_FAILED")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "TASKS_BACKUP_FAILED")?;
    }
    if fs::read(&path).map_err(|_| "TASKS_BACKUP_FAILED")? != bytes {
        return Err("TASKS_BACKUP_FAILED".into());
    }
    Ok(json!({"path":path,"sha256":digest,"records":rows.len()}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_oversized_output_and_keeps_fixed_ssh_destination() {
        assert!(bounded_read(&b"large"[..], 2).is_err());
        assert_eq!(bounded_read(&b"ok"[..], 2).unwrap(), b"ok");
        #[cfg(not(feature = "tasks-acceptance"))]
        assert!(remote_command()
            .unwrap()
            .contains("--root \"$ATLAS_TASKS\" rpc"));
    }
    #[test]
    fn refuses_arbitrary_rpc_actions_without_starting_ssh() {
        assert!(rpc(json!({"schema":1,"action":"exec","command":"anything"})).is_err());
    }
}
