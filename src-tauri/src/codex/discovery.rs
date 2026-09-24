use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::process::OwnedJob;
use super::protocol::{HostError, HostResult};

const SUPPORTED_VERSION: &str = "codex-cli 0.155.1";

#[derive(Debug, Clone)]
pub struct Launch {
    pub executable: PathBuf,
    pub prefix: Vec<OsString>,
    pub display_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub executable_path: String,
    pub version: String,
    pub supported: bool,
}

fn find_on_path(names: &[&str]) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&paths) {
        for name in names {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return candidate.canonicalize().ok();
            }
        }
    }
    None
}

fn launch_from_path(path: &Path) -> HostResult<Launch> {
    let selected = path
        .canonicalize()
        .map_err(|_| HostError::new("not_found", "Codex executable was not found"))?;
    if !selected.is_file() || !selected.is_absolute() {
        return Err(HostError::new(
            "invalid_argument",
            "Codex path must be an existing absolute file",
        ));
    }
    let extension = selected
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();
    if extension.eq_ignore_ascii_case("exe") {
        return Ok(Launch {
            executable: selected.clone(),
            prefix: vec![],
            display_path: selected,
        });
    }
    if extension.eq_ignore_ascii_case("cmd")
        && selected
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case("codex.cmd"))
    {
        // Resolve the selected npm shim through its adjacent Codex package. The
        // pinned 0.155.1 native binary can be supervised directly by a Job Object.
        // This never hardcodes a user profile path or executes cmd.exe.
        let package_root = selected
            .parent()
            .unwrap()
            .join("node_modules")
            .join("@openai")
            .join("codex");
        if !package_root.join("bin").join("codex.js").is_file() {
            return Err(HostError::new(
                "not_found",
                "The selected Codex npm shim has no package entry point",
            ));
        }
        #[cfg(target_arch = "aarch64")]
        let (package, target) = ("codex-win32-arm64", "aarch64-pc-windows-msvc");
        #[cfg(not(target_arch = "aarch64"))]
        let (package, target) = ("codex-win32-x64", "x86_64-pc-windows-msvc");
        let candidate = package_root
            .join("node_modules")
            .join("@openai")
            .join(package)
            .join("vendor")
            .join(target)
            .join("bin")
            .join("codex.exe");
        let native = candidate.canonicalize().map_err(|_| {
            HostError::new(
                "not_found",
                "The Codex npm shim's native binary was not found",
            )
        })?;
        if !native.is_file() {
            return Err(HostError::new(
                "not_found",
                "The Codex native binary was not found",
            ));
        }
        return Ok(Launch {
            executable: native.clone(),
            prefix: vec![],
            display_path: native,
        });
    }
    Err(HostError::new(
        "invalid_argument",
        "Select codex.exe or the Codex npm codex.cmd shim",
    ))
}

pub fn discover(selected: Option<&str>) -> HostResult<(Launch, Discovery)> {
    let path = match selected {
        Some(value) if !value.trim().is_empty() => {
            let path = PathBuf::from(value);
            if !path.is_absolute() {
                return Err(HostError::new(
                    "invalid_argument",
                    "Codex path must be absolute",
                ));
            }
            path
        }
        _ => find_on_path(&["codex.exe", "codex.cmd"])
            .ok_or_else(|| HostError::new("not_found", "Codex CLI was not found on PATH"))?,
    };
    let launch = launch_from_path(&path)?;
    let version = query_version(&launch)?;
    let result = Discovery {
        executable_path: launch.display_path.to_string_lossy().into_owned(),
        supported: version == SUPPORTED_VERSION,
        version,
    };
    Ok((launch, result))
}

fn query_version(launch: &Launch) -> HostResult<String> {
    let mut command = Command::new(&launch.executable);
    command
        .args(&launch.prefix)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|_| HostError::new("not_found", "Could not start Codex version check"))?;
    let job = match OwnedJob::assign(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| HostError::new("internal", "Could not inspect Codex version process"))?
        {
            if !status.success() {
                return Err(HostError::new("not_found", "Codex version check failed"));
            }
            break;
        }
        if Instant::now() >= deadline {
            job.terminate();
            let _ = child.wait();
            return Err(HostError::new("timeout", "Codex version check timed out"));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut bytes = Vec::new();
    use std::io::Read;
    child
        .stdout
        .take()
        .unwrap()
        .take(4096)
        .read_to_end(&mut bytes)
        .map_err(|_| HostError::new("internal", "Could not read Codex version"))?;
    drop(job);
    let version = String::from_utf8(bytes)
        .map_err(|_| HostError::new("protocol_error", "Invalid Codex version output"))?;
    let version = version.trim().to_owned();
    if !version.starts_with("codex-cli ") {
        return Err(HostError::new(
            "protocol_error",
            "Unexpected Codex version output",
        ));
    }
    Ok(version)
}
