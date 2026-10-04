// TABS desktop shell.
//
// Phase 2 native features:
//   * Single-instance: a second launch focuses the existing window.
//   * Notification: tauri-plugin-notification (test command below).
//   * Global shortcut Ctrl+Shift+Space: focuses the main window from any app.
//   * Tray icon: Show TABS / Quit menu.
//   * File open: argv is scanned for an existing file path (Open With / double-
//     click). Path is stored as pending state and emitted as `tabs://open-file`
//     so the frontend can open it even if the listener attaches late.
#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
use std::sync::Mutex;

#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
use tauri::{Emitter, Manager, WindowEvent};
#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
mod cli_providers;
#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
mod codex;
#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
mod commands;
#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
mod terminal;
#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
mod tray;

#[cfg(feature = "tasks-acceptance")]
mod task_acceptance;
#[cfg(not(feature = "clients-acceptance"))]
mod task_authority;
#[cfg(all(feature = "tasks-acceptance", feature = "clients-acceptance"))]
compile_error!("Choose exactly one acceptance runtime");

#[cfg(feature = "clients-acceptance")]
mod acceptance;
#[cfg(feature = "clients-acceptance")]
mod gmail;

/// Path from OS "Open With" / file association that the frontend has not yet
/// consumed. Survives the race where setup emits before the webview listens.
#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
struct PendingOpenFile(Mutex<Option<String>>);

/// Pick the first argv entry that looks like a real file to open.
/// Skips flags (`-…`) and the executable path itself.
#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
fn extract_open_file_path(args: impl IntoIterator<Item = String>) -> Option<String> {
    for arg in args {
        let trimmed = arg.trim();
        if trimmed.is_empty() || trimmed.starts_with('-') {
            continue;
        }
        let p = std::path::Path::new(trimmed);
        // Windows "Open with" passes the absolute path; only accept existing files.
        if p.is_file() {
            return Some(trimmed.to_string());
        }
    }
    None
}

#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
fn queue_open_file(app: &tauri::AppHandle, path: String) {
    if let Some(state) = app.try_state::<PendingOpenFile>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = Some(path.clone());
        }
    }
    let _ = app.emit("tabs://open-file", path);
}

// Convenience command to exercise the notification plugin from the webview
// devtools console:
//   await window.__TAURI__.core.invoke('test_notification')
#[tauri::command]
#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
fn test_notification(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title("TABS")
        .body("Phase 2 notification test")
        .show()
        .map_err(|e| e.to_string())
}

/// Frontend calls this on mount to recover a cold-start Open With path that
/// may have been emitted before the event listener was registered.
#[tauri::command]
#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
fn take_pending_open_file(state: tauri::State<'_, PendingOpenFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(feature = "tasks-acceptance")]
    task_acceptance::run();
    #[cfg(feature = "clients-acceptance")]
    {
        acceptance::run();
    }
    #[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
    run_production();
}

#[cfg(not(any(feature = "clients-acceptance", feature = "tasks-acceptance")))]
fn run_production() {
    let context = tauri::generate_context!();
    assert_eq!(
        context.config().identifier,
        "com.tabs.app",
        "Production build requires the production application identity"
    );
    // Single-instance is release-only. If it is also enabled in debug, an
    // already-running installed TABS (often hidden in the tray after close)
    // causes `npm run tauri:dev` to start and immediately exit — looking
    // like the dev command "keeps quitting".
    let builder = tauri::Builder::default();

    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        // Second launch focuses the existing window instead of starting another.
        focus_main_window(app);
        // Forward Open With / double-click path from the second process.
        // argv[0] is the executable; remaining args may include the file path.
        if let Some(path) = extract_open_file_path(argv.into_iter().skip(1)) {
            queue_open_file(app, path);
        }
    }));

    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(terminal::TerminalRegistry::new())
        .manage(std::sync::Arc::new(
            cli_providers::runs::RunRegistry::default(),
        ))
        .manage(PendingOpenFile(Mutex::new(None)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed
                        && shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Space)
                    {
                        focus_main_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            task_authority::task_authority_rpc,
            task_authority::task_authority_backup,
            test_notification,
            take_pending_open_file,
            commands::secrets::legacy_ai_preference,
            commands::secrets::legacy_ai_cleanup,
            commands::terminal::terminal_create,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_kill,
            commands::terminal::terminal_list,
            commands::terminal::home_dir,
            commands::codex::codex_discover,
            commands::codex::codex_connect,
            commands::codex::codex_begin_login,
            commands::codex::codex_cancel_login,
            commands::codex::codex_status,
            commands::codex::codex_list_models,
            commands::codex::codex_default_workspace,
            commands::codex::codex_read_scoped_text_file,
            commands::codex::codex_list_scoped_documents,
            commands::codex::codex_scoped_document_hash,
            commands::codex::codex_create_scoped_document,
            commands::codex::codex_read_thread,
            commands::codex::codex_start_thread,
            commands::codex::codex_resume_thread,
            commands::codex::codex_start_turn,
            commands::codex::codex_interrupt_turn,
            commands::codex::codex_reply_request,
            commands::codex::codex_replay_events,
            commands::codex::codex_ack_events,
            commands::codex::codex_disconnect,
            commands::cli_providers::cli_provider_probe,
            commands::cli_providers::cli_provider_default_workspace,
            commands::cli_runs::cli_provider_run,
            commands::cli_runs::cli_provider_stop,
        ])
        .setup(|app| {
            let event_window = app.get_webview_window("main").ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "TABS main window is unavailable",
                )
            })?;
            let mut protected_roots = vec![
                app.path().app_data_dir()?,
                app.path().app_local_data_dir()?,
                app.path().app_config_dir()?,
            ];
            let codex_home = std::env::var_os("CODEX_HOME")
                .map(std::path::PathBuf::from)
                .or_else(|| {
                    std::env::var_os("USERPROFILE")
                        .map(|profile| std::path::PathBuf::from(profile).join(".codex"))
                });
            if let Some(path) = codex_home {
                protected_roots.push(path);
            }
            let journal_dir = app.path().app_local_data_dir()?.join("codex-event-journal");
            app.manage(std::sync::Arc::new(
                codex::CodexHost::new(move |event| {
                    let _ = event_window.emit("codex://event", event);
                })
                .with_protected_roots(protected_roots)
                .with_journal(&journal_dir),
            ));
            // Intercept the main window's close button: instead of quitting
            // the app, hide the window so the tray icon remains usable.
            // The user can quit from the tray's "Quit" menu item, or by
            // pressing Ctrl+Shift+Space (which will refocus the hidden
            // window if it's still running).
            if let Some(window) = app.get_webview_window("main") {
                let window_for_close = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                });
            }

            // The main window is now created with `visible: true` in
            // tauri.conf.json so it shows up reliably on first launch.
            // We still call `show()` + `set_focus()` here as a belt-and-
            // braces guarantee: this runs after WebView2 is initialized
            // and the window is fully ready, so the show will actually
            // take effect (the old `visible: false` + immediate show()
            // had a race that left the window invisible on some machines).
            focus_main_window(app.handle());

            // Register Ctrl+Shift+Space as the "focus TABS" global hotkey.
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            if let Err(e) = app.global_shortcut().register(shortcut) {
                eprintln!("[TABS] Failed to register Ctrl+Shift+Space: {e}");
            }

            // Build the tray icon.
            tray::build(app.handle())?;

            // Cold-start Open With / file association: store + emit so the
            // frontend can open the file after it mounts (take_pending_open_file
            // covers the race if the event fires too early).
            if let Some(path) = extract_open_file_path(std::env::args().skip(1)) {
                queue_open_file(app.handle(), path);
            }

            Ok(())
        })
        .run(context)
        .expect("error while running tauri application");
}
