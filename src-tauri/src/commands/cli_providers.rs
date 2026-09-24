use tauri::WebviewWindow;

use crate::cli_providers::{self, CliProviderProbe};
use crate::codex::{HostError, HostResult};

#[tauri::command]
pub async fn cli_provider_probe(
    window: WebviewWindow,
    provider_id: String,
) -> HostResult<CliProviderProbe> {
    if window.label() != "main" {
        return Err(HostError::new(
            "invalid_argument",
            "CLI providers are available only to the main TABS window",
        ));
    }
    if !matches!(provider_id.as_str(), "grok" | "commandCode" | "openCode") {
        return Err(HostError::new(
            "invalid_argument",
            "Unsupported CLI provider",
        ));
    }
    tauri::async_runtime::spawn_blocking(move || cli_providers::probe(&provider_id))
        .await
        .map_err(|_| HostError::new("internal", "CLI provider probe could not finish"))
}

#[tauri::command]
pub fn cli_provider_default_workspace(window: WebviewWindow) -> HostResult<String> {
    if window.label() != "main" {
        return Err(HostError::new(
            "invalid_argument",
            "CLI providers are available only to the main TABS window",
        ));
    }
    let path = std::env::temp_dir().join("tabs-cli-workspace");
    std::fs::create_dir_all(&path)
        .map_err(|_| HostError::new("internal", "Could not prepare the CLI workspace"))?;
    path.canonicalize()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|_| HostError::new("internal", "Could not resolve the CLI workspace"))
}
