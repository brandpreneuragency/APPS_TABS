//! Task-only native acceptance; distinct identity, WebView profile and fixed VPS fixture.
use crate::task_authority;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use tauri::{Manager, WebviewWindowBuilder};

const IDENTIFIER: &str = "com.tabs.tasks.acceptance";

#[tauri::command]
fn tasks_acceptance_report(app: tauri::AppHandle, report: Value) -> Result<(), String> {
    let local = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let digest = format!(
        "{:x}",
        Sha256::digest(fs::read(&exe).map_err(|e| e.to_string())?)
    );
    let result = json!({"identifier":IDENTIFIER,"fixture":task_authority::fixture_name()?,
        "pid":std::process::id(),"executable":exe,"sha256":digest,"appLocalData":local,
        "webviewProfile":local.join("webview"),"report":report});
    fs::write(
        local.join("acceptance-result.json"),
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .map_err(|e| e.to_string())
}

pub fn run() {
    let context = tauri::generate_context!();
    let config = context.config();
    assert_eq!(config.identifier, IDENTIFIER);
    assert!(!config.bundle.active);
    assert!(!config.app.windows[0].create);
    assert!(config
        .bundle
        .file_associations
        .as_ref()
        .is_none_or(|v| v.is_empty()));
    task_authority::fixture_name().expect("Dedicated VPS fixture is required");
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![task_authority::task_authority_rpc,
            task_authority::task_authority_backup, tasks_acceptance_report])
        .setup(|app| {
            let local = app.path().app_local_data_dir()?;
            assert_eq!(local, app.path().local_data_dir()?.join(IDENTIFIER));
            let webview = local.join("webview");
            fs::create_dir_all(&webview)?;
            let mut cursor = webview.as_path();
            while let Some(parent) = cursor.parent() {
                let metadata = fs::symlink_metadata(cursor)?;
                if metadata.file_type().is_symlink() { return Err("Linked acceptance path".into()); }
                #[cfg(windows)] {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 { return Err("Acceptance reparse point".into()); }
                }
                cursor = parent;
            }
            let name = serde_json::to_string(&task_authority::fixture_name()?)?;
            WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .data_directory(webview)
                .initialization_script(format!("Object.defineProperty(window, '__TABS_TASKS_ACCEPTANCE__', {{value: {name}, writable: false, configurable: false}});"))
                .build()?;
            Ok(())
        })
        .run(context).expect("Task acceptance runtime failed");
}
