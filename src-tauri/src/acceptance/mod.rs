//! Separate native startup. Production commands/plugins and file-open forwarding are absent.
use crate::gmail::{self, AuthStatus, GmailError, GmailHost, ReadAccessReport};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::PathBuf, sync::Arc};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewWindowBuilder,
};

const IDENTIFIER: &str = "com.tabs.clients.acceptance";
const TITLE: &str = "TABS Clients Acceptance";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostics {
    schema_version: u8,
    identifier: String,
    pid: u32,
    executable_path: PathBuf,
    executable_sha256: String,
    app_data: PathBuf,
    app_local_data: PathBuf,
    app_config: PathBuf,
    webview_profile: PathBuf,
    credential_service: String,
    private_root: PathBuf,
    database_name: String,
    startup_at: u64,
    previous_startup_at: Option<u64>,
    ui_ipc_reached: bool,
    sends_enabled: bool,
    g1_passed: bool,
}

fn command_error() -> GmailError {
    GmailError {
        code: "CONFLICT",
        retryable: false,
        detail_key: "CONFLICT",
    }
}

#[tauri::command]
fn clients_acceptance_diagnostics(
    state: tauri::State<'_, Diagnostics>,
) -> Result<Diagnostics, String> {
    let mut report = state.inner().clone();
    report.ui_ipc_reached = true;
    gmail::write_json_file(&report.private_root.join("runtime.json"), &report)
        .map_err(|_| "Acceptance diagnostic write failed".to_string())?;
    Ok(report)
}
#[tauri::command]
fn clients_acceptance_quit(app: tauri::AppHandle, host: tauri::State<'_, Arc<GmailHost>>) {
    host.cancel();
    app.exit(0);
}
#[tauri::command]
fn gmail_status(host: tauri::State<'_, Arc<GmailHost>>) -> Result<AuthStatus, GmailError> {
    host.status()
}
#[tauri::command]
fn gmail_cancel(host: tauri::State<'_, Arc<GmailHost>>) {
    host.cancel();
}
#[tauri::command]
async fn gmail_connect(
    host: tauri::State<'_, Arc<GmailHost>>,
    expected_mailbox: String,
) -> Result<AuthStatus, GmailError> {
    let host = Arc::clone(&host);
    tauri::async_runtime::spawn_blocking(move || host.connect(expected_mailbox))
        .await
        .map_err(|_| command_error())?
}
#[tauri::command]
async fn gmail_refresh(host: tauri::State<'_, Arc<GmailHost>>) -> Result<AuthStatus, GmailError> {
    let host = Arc::clone(&host);
    tauri::async_runtime::spawn_blocking(move || host.refresh())
        .await
        .map_err(|_| command_error())?
}
#[tauri::command]
async fn gmail_check_read_access(
    host: tauri::State<'_, Arc<GmailHost>>,
) -> Result<ReadAccessReport, GmailError> {
    let host = Arc::clone(&host);
    tauri::async_runtime::spawn_blocking(move || host.check_read_access())
        .await
        .map_err(|_| command_error())?
}
#[tauri::command]
async fn gmail_disconnect(
    host: tauri::State<'_, Arc<GmailHost>>,
) -> Result<AuthStatus, GmailError> {
    let host = Arc::clone(&host);
    tauri::async_runtime::spawn_blocking(move || host.disconnect())
        .await
        .map_err(|_| command_error())?
}

fn validate_config(config: &tauri::Config) -> Result<(), &'static str> {
    if config.identifier != IDENTIFIER
        || config.product_name.as_deref() != Some(TITLE)
        || config.bundle.active
        || config.bundle.create_updater_artifacts != tauri::utils::config::Updater::Bool(false)
        || config
            .bundle
            .file_associations
            .as_ref()
            .is_some_and(|a| !a.is_empty())
        || config.app.windows.len() != 1
        || config.app.windows[0].create
        || config.app.windows[0].label != "main"
    {
        return Err("Acceptance requires its dedicated configuration and disabled bundling");
    }
    Ok(())
}

pub fn run() {
    let context = tauri::generate_context!();
    validate_config(context.config()).expect("Unsafe acceptance configuration");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![clients_acceptance_diagnostics, clients_acceptance_quit,
            gmail_status, gmail_connect, gmail_cancel, gmail_refresh, gmail_disconnect, gmail_check_read_access])
        .setup(|app| {
            let local = app.path().app_local_data_dir()?;
            let expected = app.path().local_data_dir()?.join(IDENTIFIER);
            if local != expected { return Err("Acceptance local data identity mismatch".into()); }
            fs::create_dir_all(&local)?;
            if local.canonicalize()? != expected.canonicalize()? { return Err("Acceptance root mismatch".into()); }
            // Refuse junction/symlink profiles rather than risk joining another application's storage.
            let mut cursor = local.clone();
            while let Some(parent) = cursor.parent() {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if fs::symlink_metadata(&cursor)?.file_attributes() & 0x400 != 0 {
                        return Err("Acceptance path contains a reparse point".into());
                    }
                }
                cursor = parent.to_path_buf();
            }
            let webview = local.join("webview");
            let private_root = local.join("clients").join("acceptance");
            fs::create_dir_all(&webview)?;
            fs::create_dir_all(&private_root)?;
            for path in [&webview, &private_root] {
                if !path.canonicalize()?.starts_with(local.canonicalize()?) { return Err("Acceptance storage escaped its root".into()); }
            }
            let previous = fs::read_to_string(private_root.join("startup.json")).ok()
                .and_then(|s| serde_json::from_str::<u64>(&s).ok());
            let startup = gmail::now_ms();
            gmail::write_json_file(&private_root.join("startup.json"), &startup).map_err(|_| "Acceptance sentinel write failed")?;
            let exe = std::env::current_exe()?;
            let mut hasher = Sha256::new();
            let mut file = fs::File::open(&exe)?;
            let mut chunk = [0; 65536];
            loop { let n = file.read(&mut chunk)?; if n == 0 { break; } hasher.update(&chunk[..n]); }
            let diagnostics = Diagnostics {
                schema_version: 1, identifier: IDENTIFIER.into(), pid: std::process::id(),
                executable_path: exe, executable_sha256: format!("{:x}", hasher.finalize()),
                app_data: app.path().app_data_dir()?, app_local_data: local,
                app_config: app.path().app_config_dir()?, webview_profile: webview.clone(),
                credential_service: format!("{IDENTIFIER}.gmail"), private_root: private_root.clone(),
                database_name: "TABSClientsAcceptanceProbe".into(), startup_at: startup,
                previous_startup_at: previous, ui_ipc_reached: false, sends_enabled: false, g1_passed: false,
            };
            gmail::write_json_file(&private_root.join("runtime.json"), &diagnostics).map_err(|_| "Acceptance diagnostics write failed")?;
            let host = GmailHost::new(private_root, IDENTIFIER).map_err(|_| "Acceptance auth initialization failed")?;
            let host = Arc::new(host);
            app.manage(Arc::clone(&host));
            // Explicit acceptance-only smoke invocation, never automatic on ordinary startup.
            if std::env::args().any(|arg| arg == "--check-read-access") {
                let report_root = diagnostics.private_root.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = host.check_read_access() {
                        let _ = gmail::write_json_file(&report_root.join("last-read-access-check.json"),
                            &serde_json::json!({"schemaVersion":1,"status":"blocked",
                                "checkedAt":gmail::now_ms(),"pid":std::process::id(),
                                "errorCode":error.code,"noSendPerformed":true,"g1Passed":false}));
                    }
                });
            }
            app.manage(diagnostics);
            WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .data_directory(webview)
                .initialization_script("Object.defineProperty(window, '__TABS_CLIENTS_ACCEPTANCE__', {value: true, writable: false, configurable: false});")
                .on_navigation(|url| matches!(url.host_str(), Some("tauri.localhost") | Some("localhost")) && matches!(url.scheme(), "http" | "https" | "tauri"))
                .build()?;
            let show = MenuItem::with_id(app, "acceptance-show", "Show TABS Clients Acceptance", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "acceptance-quit", "Quit TABS Clients Acceptance", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("tabs-clients-acceptance-tray").tooltip(TITLE).menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "acceptance-show" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } },
                    "acceptance-quit" => { app.state::<Arc<GmailHost>>().cancel(); app.exit(0); },
                    _ => (),
                });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            Ok(())
        })
        .run(context).expect("Acceptance application failed");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn production_config_cannot_start_acceptance_runtime() {
        let config: tauri::Config =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert!(validate_config(&config).is_err());
    }
    #[test]
    fn acceptance_config_requires_manual_profile_creation() {
        let mut config: tauri::Config =
            serde_json::from_str(include_str!("../../tauri.clients-acceptance.conf.json")).unwrap();
        assert!(validate_config(&config).is_ok());
        config.app.windows[0].create = true;
        assert!(validate_config(&config).is_err());
    }
}
