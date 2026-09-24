use std::sync::Arc;

use tauri::{State, WebviewWindow};

use crate::cli_providers::runs::{self, RunRegistry, RunRequest, RunResult};
use crate::codex::{HostError, HostResult};

fn require_main_window(window: &WebviewWindow) -> HostResult<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(HostError::new(
            "invalid_argument",
            "CLI providers are available only to the main TABS window",
        ))
    }
}

#[tauri::command]
pub async fn cli_provider_run(
    window: WebviewWindow,
    registry: State<'_, Arc<RunRegistry>>,
    request: RunRequest,
) -> HostResult<RunResult> {
    require_main_window(&window)?;
    runs::validate_request(&request)?;
    let registry = Arc::clone(registry.inner());
    let run_id = request.run_id.clone();
    let control = registry.begin(&run_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || runs::run(request, control))
        .await
        .map_err(|_| HostError::new("internal", "CLI run could not finish"));
    registry.finish(&run_id);
    result?
}

#[tauri::command]
pub fn cli_provider_stop(
    window: WebviewWindow,
    registry: State<'_, Arc<RunRegistry>>,
    run_id: String,
) -> HostResult<bool> {
    require_main_window(&window)?;
    registry.stop(&run_id)
}
