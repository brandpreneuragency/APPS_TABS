//! Independent read-only observations. No credential values cross this boundary.
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::WebviewWindow;

const SCRIPT: &str = include_str!("collector.py");
const LIMIT: u64 = 16 * 1024;
// Re-resolve every invocation, fail before Python on resolver error. The timeout
// also bounds the resolver, and remote stdin is only the reviewed collector.
const REMOTE: &str = "timeout 18s sh -c 'resolved=$(sh /home/admin/.hermes/skills/atlas/atlas-map/scripts/resolve.sh) || exit $?; eval \"$resolved\"; test -n \"$HERMES_DIR\" && test -d \"$HERMES_DIR\" || exit 1; export HERMES_DIR; exec python3 -I -B - --remote'";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConsumerIdentity {
    pub key: Option<String>,
    pub email: Option<String>,
    pub workspace_id: Option<String>,
    pub plan: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConsumerObservation {
    pub id: String,
    pub provider_id: Option<String>,
    pub identity: Option<ConsumerIdentity>,
    pub evidence: String,
    pub observed_at: Option<u64>,
    pub error: Option<String>,
}

fn unavailable(id: &str, reason: &str) -> ConsumerObservation {
    ConsumerObservation {
        id: id.into(),
        provider_id: None,
        identity: None,
        evidence: "unavailable".into(),
        observed_at: None,
        error: Some(reason.into()),
    }
}

fn safe_display(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1024
        && !value.chars().any(char::is_control)
        && !value.starts_with("eyJ")
        && !value.starts_with("sk-")
        && !value.starts_with("Bearer ")
}

fn parse(bytes: &[u8], remote: bool) -> Result<Vec<ConsumerObservation>, ()> {
    if bytes.len() as u64 > LIMIT {
        return Err(());
    }
    let rows: Vec<ConsumerObservation> = serde_json::from_slice(bytes).map_err(|_| ())?;
    let ids = if remote {
        ["hermes-vps", "opencode-vps"]
    } else {
        ["hermes-mother", "opencode-mother"]
    };
    if rows.len() != 2 {
        return Err(());
    }
    for (row, expected) in rows.iter().zip(ids) {
        if row.id != expected || !matches!(row.evidence.as_str(), "configured" | "unavailable") {
            return Err(());
        }
        if row
            .provider_id
            .as_deref()
            .is_some_and(|x| x != "openai-codex")
        {
            return Err(());
        }
        if row.evidence == "unavailable" && (row.identity.is_some() || row.provider_id.is_some()) {
            return Err(());
        }
        if row.evidence == "configured" && row.provider_id.as_deref() != Some("openai-codex") {
            return Err(());
        }
        if !matches!(
            row.error.as_deref(),
            None | Some(
                "notConfigured"
                    | "multipleConfiguredAccounts"
                    | "identityUnavailable"
                    | "runtimeUnverified"
                    | "sourceUnavailable"
                    | "unsupportedStore"
                    | "probeUnavailable"
                    | "connectionFailed"
                    | "runtimeStoreAmbiguous"
            )
        ) {
            return Err(());
        }
        if row.observed_at.is_none() {
            return Err(());
        }
        if let Some(identity) = &row.identity {
            if identity.key.as_ref().is_some_and(|key| {
                key.len() != 64
                    || !key
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            }) {
                return Err(());
            }
            for value in [&identity.email, &identity.workspace_id, &identity.plan]
                .into_iter()
                .flatten()
            {
                if !safe_display(value) {
                    return Err(());
                }
            }
        }
    }
    Ok(rows)
}

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn run(mut command: Command) -> Result<Vec<u8>, ()> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = OwnedChild(command.spawn().map_err(|_| ())?);
    let mut input = child.0.stdin.take().ok_or(())?;
    let output = child.0.stdout.take().ok_or(())?;
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = output
            .take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = tx.send(result);
    });
    let writer = std::thread::spawn(move || input.write_all(SCRIPT.as_bytes()));
    let deadline = Instant::now() + Duration::from_secs(24);
    let mut bytes = None;
    let result = loop {
        if bytes.is_none() {
            match rx.try_recv() {
                Ok(Ok(value)) if value.len() as u64 <= LIMIT => bytes = Some(value),
                Ok(_) | Err(mpsc::TryRecvError::Disconnected) => break Err(()),
                Err(mpsc::TryRecvError::Empty) => (),
            }
        }
        match child.0.try_wait() {
            Ok(Some(status)) if !status.success() => break Err(()),
            Ok(Some(_)) if bytes.is_some() => break Ok(bytes.take().unwrap_or_default()),
            Err(_) => break Err(()),
            _ => (),
        }
        if Instant::now() >= deadline {
            break Err(());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    drop(child); // close pipes even on timeout / over-limit / nonzero exit
                 // Neither fixed child can spawn local descendants. Do not wait on threads:
                 // a remote channel shutdown can lag; bounded buffers and closed child own it.
    drop(reader);
    drop(writer);
    result
}

fn local_python() -> Option<PathBuf> {
    // Never execute a relative PATH hit, app-execution alias, project virtualenv,
    // or a user-supplied command. Only existing native installation locations.
    let local = PathBuf::from(std::env::var_os("LOCALAPPDATA")?);
    let mut candidates = Vec::new();
    for version in ["314", "313", "312", "311"] {
        candidates.push(local.join(format!("Programs/Python/Python{version}/python.exe")));
        if let Some(programs) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(programs).join(format!("Python{version}/python.exe")));
        }
    }
    // Hermes' embedded interpreter is an existing standalone stdlib Python,
    // not Hermes itself. Inspect interpreter directory names, not app stores.
    if let Ok(entries) = std::fs::read_dir(local.join("hermes/tools")) {
        let mut embedded: Vec<_> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name();
                let name = name.to_str()?;
                (name.starts_with("python-3.")
                    && name.ends_with("-win32-x64")
                    && entry.file_type().ok()?.is_dir())
                .then(|| entry.path().join("python.exe"))
            })
            .collect();
        embedded.sort();
        embedded.reverse();
        candidates.extend(embedded);
    }
    candidates
        .into_iter()
        .find(|path| path.is_absolute() && path.is_file())
}

fn refresh() -> Vec<ConsumerObservation> {
    let local = local_python()
        .and_then(|python| {
            let mut command = Command::new(python);
            command.args(["-I", "-B", "-"]);
            run(command)
                .ok()
                .and_then(|bytes| parse(&bytes, false).ok())
        })
        .unwrap_or_else(|| {
            vec![
                unavailable("hermes-mother", "probeUnavailable"),
                unavailable("opencode-mother", "probeUnavailable"),
            ]
        });
    // Pin the OS SSH binary; no general SSH command or hostname surface.
    let ssh = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .map(|root| root.join("System32/OpenSSH/ssh.exe"));
    let remote = ssh
        .filter(|path| path.is_absolute() && path.is_file())
        .and_then(|ssh| {
            let mut command = Command::new(ssh);
            command.args([
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=7",
                "-o",
                "ConnectionAttempts=1",
                "-o",
                "ServerAliveInterval=3",
                "-o",
                "ServerAliveCountMax=2",
                "-o",
                "PermitLocalCommand=no",
                "-o",
                "ClearAllForwardings=yes",
                "-o",
                "ProxyCommand=none",
                "-o",
                "ProxyJump=none",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                "UpdateHostKeys=no",
                "-o",
                "ControlMaster=no",
                "-o",
                "ControlPath=none",
                "-o",
                "ControlPersist=no",
                "-o",
                "ForwardAgent=no",
                "-o",
                "ForwardX11=no",
                "admin@atlas-vps",
                REMOTE,
            ]);
            run(command).ok().and_then(|bytes| parse(&bytes, true).ok())
        })
        .unwrap_or_else(|| {
            vec![
                unavailable("hermes-vps", "connectionFailed"),
                unavailable("opencode-vps", "connectionFailed"),
            ]
        });
    local.into_iter().chain(remote).collect()
}

#[tauri::command]
pub async fn provider_connections_refresh(
    window: WebviewWindow,
) -> Result<Vec<ConsumerObservation>, String> {
    if window.label() != "main" {
        return Err("consumerObservationNotAllowed".into());
    }
    tauri::async_runtime::spawn_blocking(refresh)
        .await
        .map_err(|_| "probeUnavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn valid() -> serde_json::Value {
        serde_json::json!([
            {"id":"hermes-mother","providerId":"openai-codex","identity":{"key":null,"email":"display@example.test","workspaceId":"account-fixture","plan":"plus"},"evidence":"configured","observedAt":1,"error":"runtimeUnverified"},
            {"id":"opencode-mother","providerId":null,"identity":null,"evidence":"unavailable","observedAt":1,"error":"notConfigured"}
        ])
    }
    #[test]
    #[ignore = "explicit authorized live native read only; never part of fixture suite"]
    fn live_read_smoke() {
        let rows = refresh();
        assert_eq!(rows.len(), 4);
        assert_eq!(
            rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            [
                "hermes-mother",
                "opencode-mother",
                "hermes-vps",
                "opencode-vps"
            ]
        );
        assert!(rows.iter().all(|r| r.evidence != "runtime"));
        println!("{}", serde_json::to_string(&rows).unwrap());
        assert!(
            rows.iter().all(|r| !matches!(
                r.error.as_deref(),
                Some("probeUnavailable" | "connectionFailed")
            )),
            "live transport unavailable (only sanitized reason codes shown above)"
        );
    }
    #[test]
    fn accepts_only_sanitized_configured_records() {
        assert!(parse(&serde_json::to_vec(&valid()).unwrap(), false).is_ok());
    }
    #[test]
    fn rejects_secret_properties() {
        for nested in [false, true] {
            let mut value = valid();
            let target = if nested {
                &mut value[0]["identity"]
            } else {
                &mut value[0]
            };
            target["access_token"] = "synthetic-never-a-token".into();
            assert!(parse(&serde_json::to_vec(&value).unwrap(), false).is_err());
        }
    }
    #[test]
    fn rejects_runtime_wrong_location_duplicate_and_freeform_errors() {
        for (field, value) in [
            ("evidence", "runtime"),
            ("id", "hermes-vps"),
            ("error", "native secret error"),
        ] {
            let mut rows = valid();
            rows[0][field] = value.into();
            assert!(parse(&serde_json::to_vec(&rows).unwrap(), false).is_err());
        }
        let mut rows = valid();
        rows[1] = rows[0].clone();
        assert!(parse(&serde_json::to_vec(&rows).unwrap(), false).is_err());
    }
    #[test]
    fn rejects_secret_shaped_values_and_oversize() {
        let mut rows = valid();
        rows[0]["identity"]["email"] = "eyJsynthetic.fixture.value".into();
        assert!(parse(&serde_json::to_vec(&rows).unwrap(), false).is_err());
        assert!(parse(&vec![b' '; LIMIT as usize + 1], false).is_err());
    }
}
