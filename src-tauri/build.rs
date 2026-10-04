fn main() {
    if std::env::var_os("CARGO_FEATURE_CLIENTS_ACCEPTANCE").is_some() {
        println!("cargo:rerun-if-changed=acceptance-permissions");
        tauri_build::try_build(
            tauri_build::Attributes::new().app_manifest(
                tauri_build::AppManifest::new()
                    .permissions_path_pattern("acceptance-permissions/*.toml"),
            ),
        )
        .expect("acceptance permissions could not be built");
    } else if std::env::var_os("CARGO_FEATURE_TASKS_ACCEPTANCE").is_some() {
        println!("cargo:rerun-if-changed=tasks-acceptance-permissions");
        tauri_build::try_build(
            tauri_build::Attributes::new().app_manifest(
                tauri_build::AppManifest::new()
                    .permissions_path_pattern("tasks-acceptance-permissions/*.toml"),
            ),
        )
        .expect("task acceptance permissions could not be built");
    } else {
        tauri_build::build()
    }
}
