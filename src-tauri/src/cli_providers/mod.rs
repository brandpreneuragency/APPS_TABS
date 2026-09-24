pub(crate) mod discovery;
mod parsers;
pub(crate) mod process;
pub(crate) mod runs;

use std::time::Duration;

use serde::Serialize;

use self::discovery::Launch;
use self::process::{run_bounded, ProcessError, ProcessOutput};

const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
const COMMAND_CODE_VERSION_TIMEOUT: Duration = Duration::from_secs(15);
const PROBE_TIMEOUT: Duration = Duration::from_secs(12);
const OUTPUT_LIMIT: usize = 512 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthState {
    Authenticated,
    NotAuthenticated,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliModel {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
    pub reasoning_efforts: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProviderProbe {
    pub provider_id: String,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub auth_state: AuthState,
    pub models: Vec<CliModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl CliProviderProbe {
    fn empty(provider_id: &str) -> Self {
        Self {
            provider_id: provider_id.to_owned(),
            installed: false,
            executable_path: None,
            version: None,
            auth_state: AuthState::Unknown,
            models: Vec::new(),
            error: None,
        }
    }
}

fn process_message(error: ProcessError, action: &str, provider_name: &str) -> String {
    let detail = match error {
        ProcessError::Start => "could not start",
        ProcessError::Ownership => "could not be supervised",
        ProcessError::Timeout => "timed out",
        ProcessError::OutputLimit => "returned too much output",
        ProcessError::Read => "could not be read",
    };
    format!("{provider_name} {action} {detail}. Check the installed CLI and try again.")
}

fn run_probe(
    launch: &Launch,
    arguments: &[&str],
    action: &str,
    provider_name: &str,
) -> Result<ProcessOutput, String> {
    let output = run_bounded(launch, arguments, PROBE_TIMEOUT, OUTPUT_LIMIT)
        .map_err(|error| process_message(error, action, provider_name))?;
    if !output.status.success() {
        return Err(format!(
            "{provider_name} {action} failed. Open the CLI to check its setup."
        ));
    }
    Ok(output)
}

fn read_version(launch: &Launch, provider_id: &str) -> Result<String, String> {
    let arguments: &[&str] = match provider_id {
        "grok" | "commandCode" => &["--version", "--no-auto-update"],
        _ => &["--version"],
    };
    let provider_name = provider_name(provider_id);
    let output = run_bounded(launch, arguments, version_timeout(provider_id), 4096)
        .map_err(|error| process_message(error, "version check", provider_name))?;
    let version = output.stdout.trim().lines().next().unwrap_or_default();
    if !output.status.success() || version.is_empty() || version.len() > 120 {
        return Err(format!(
            "{provider_name} version check failed. Open the CLI to check its setup."
        ));
    }
    Ok(version.to_owned())
}

fn version_timeout(provider_id: &str) -> Duration {
    if provider_id == "commandCode" {
        COMMAND_CODE_VERSION_TIMEOUT
    } else {
        VERSION_TIMEOUT
    }
}

fn command_code_model_docs(launch: &Launch) -> Option<String> {
    let entry = launch.arguments.first()?.to_str()?;
    let path = std::path::Path::new(entry)
        .parent()?
        .join("bundled")
        .join("command-code-knowledge")
        .join("reference")
        .join("models.md");
    if std::fs::metadata(&path).ok()?.len() > OUTPUT_LIMIT as u64 {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// Returns only safe provider metadata; raw CLI output and credentials never
/// cross the Tauri boundary.
pub fn probe(provider_id: &str) -> CliProviderProbe {
    let mut result = CliProviderProbe::empty(provider_id);
    let launch = match discovery::discover(provider_id) {
        Ok(launch) => launch,
        Err(message) => {
            result.error = Some(message.to_owned());
            return result;
        }
    };
    result.installed = true;
    result.executable_path = Some(launch.display_path.to_string_lossy().into_owned());
    match read_version(&launch, provider_id) {
        Ok(version) => result.version = Some(version),
        Err(message) => {
            result.error = Some(message);
            return result;
        }
    }

    match provider_id {
        "grok" => match run_bounded(&launch, &["models"], PROBE_TIMEOUT, OUTPUT_LIMIT) {
            Ok(output) => {
                let (auth, models) = parsers::grok_auth_and_models(&output.stdout);
                result.auth_state = auth;
                result.models = models;
                if !output.status.success() && auth == AuthState::Unknown {
                    result.error = Some(
                        "Grok Build model list failed. Open the CLI to check its setup.".to_owned(),
                    );
                }
            }
            Err(error) => result.error = Some(process_message(error, "model list", "Grok Build")),
        },
        "commandCode" => {
            match run_bounded(
                &launch,
                &["status", "--json", "--no-auto-update", "--skip-onboarding"],
                PROBE_TIMEOUT,
                OUTPUT_LIMIT,
            ) {
                Ok(output) => {
                    result.auth_state = parsers::command_code_auth(&output.stdout);
                    if !output.status.success() && result.auth_state == AuthState::Unknown {
                        result.error = Some(
                            "Command Code status check failed. Open the CLI to check its setup."
                                .to_owned(),
                        );
                    }
                }
                Err(error) => {
                    result.error = Some(process_message(error, "status check", "Command Code"))
                }
            }
            match run_probe(
                &launch,
                &["--list-models", "--no-auto-update", "--skip-onboarding"],
                "model list",
                "Command Code",
            ) {
                Ok(output) => {
                    result.models = parsers::command_code_models(&output.stdout);
                    if let Some(docs) = command_code_model_docs(&launch) {
                        parsers::enrich_command_code_models_with_docs(&mut result.models, &docs);
                    }
                    runs::remember_command_code_model_efforts(&result.models);
                }
                Err(message) if result.error.is_none() => result.error = Some(message),
                Err(_) => {}
            }
        }
        "openCode" => {
            match run_probe(
                &launch,
                &["providers", "list", "--pure"],
                "credential status check",
                "OpenCode",
            ) {
                Ok(output) => result.auth_state = parsers::open_code_auth(&output.stdout),
                Err(message) => result.error = Some(message),
            }
            match run_probe(&launch, &["models", "--pure"], "model list", "OpenCode") {
                Ok(output) => {
                    result.models = parsers::open_code_models(&output.stdout);
                    if !result.models.is_empty() {
                        if let Ok(verbose) = run_probe(
                            &launch,
                            &["models", "--pure", "--verbose"],
                            "verbose model list",
                            "OpenCode",
                        ) {
                            parsers::enrich_open_code_models_with_verbose(
                                &mut result.models,
                                &verbose.stdout,
                            );
                        }
                    }
                    runs::remember_open_code_model_efforts(&result.models);
                }
                Err(message) if result.error.is_none() => result.error = Some(message),
                Err(_) => {}
            }
        }
        _ => {}
    }
    if result.models.is_empty() && result.error.is_none() {
        result.error = Some(if result.auth_state == AuthState::NotAuthenticated {
            format!(
                "Sign in with the {} CLI to load models.",
                provider_name(provider_id)
            )
        } else {
            format!(
                "{} returned no models. Open the CLI to check its setup.",
                provider_name(provider_id)
            )
        });
    }
    result
}

fn provider_name(provider_id: &str) -> &'static str {
    match provider_id {
        "grok" => "Grok Build",
        "commandCode" => "Command Code",
        "openCode" => "OpenCode",
        _ => "CLI provider",
    }
}

#[cfg(test)]
mod tests {
    use super::{version_timeout, COMMAND_CODE_VERSION_TIMEOUT, VERSION_TIMEOUT};

    #[test]
    fn reserves_extra_startup_time_only_for_command_code_version_checks() {
        assert_eq!(version_timeout("commandCode"), COMMAND_CODE_VERSION_TIMEOUT);
        assert_eq!(version_timeout("grok"), VERSION_TIMEOUT);
        assert_eq!(version_timeout("openCode"), VERSION_TIMEOUT);
    }
}
