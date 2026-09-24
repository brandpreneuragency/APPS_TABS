use std::io::Write;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{State, WebviewWindow};

use crate::codex::{
    CodexHost, Connection, Discovery, HostError, HostResult, LoginStart, Model, NativeTurn, Replay,
    RequestReply, ThreadRequest, ToolSpec, TurnRequest,
};

fn join_error() -> HostError {
    HostError::new("internal", "Codex host operation could not finish")
}

fn require_main_window(window: &WebviewWindow) -> HostResult<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(HostError::new(
            "invalid_argument",
            "Codex is available only to the main TABS window",
        ))
    }
}

#[tauri::command]
pub async fn codex_discover(window: WebviewWindow, path: Option<String>) -> HostResult<Discovery> {
    require_main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || CodexHost::discover(path.as_deref()))
        .await
        .map_err(|_| join_error())?
}

#[tauri::command]
pub async fn codex_connect(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    executable_path: Option<String>,
    workspace_root: String,
) -> HostResult<Connection> {
    require_main_window(&window)?;
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || {
        host.connect(executable_path.as_deref(), &workspace_root)
    })
    .await
    .map_err(|_| join_error())?
}

#[tauri::command]
pub async fn codex_begin_login(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    executable_path: Option<String>,
    workspace_root: String,
) -> HostResult<LoginStart> {
    require_main_window(&window)?;
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || {
        host.begin_login(executable_path.as_deref(), &workspace_root)
    })
    .await
    .map_err(|_| join_error())?
}

#[tauri::command]
pub async fn codex_cancel_login(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    epoch: u64,
    login_id: String,
) -> HostResult<()> {
    require_main_window(&window)?;
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.cancel_login(epoch, &login_id))
        .await
        .map_err(|_| join_error())?
}

#[tauri::command]
pub fn codex_status(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
) -> HostResult<Option<Connection>> {
    require_main_window(&window)?;
    Ok(host.status())
}

#[tauri::command]
pub async fn codex_list_models(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    epoch: u64,
) -> HostResult<Vec<Model>> {
    require_main_window(&window)?;
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.list_models(epoch))
        .await
        .map_err(|_| join_error())?
}

#[tauri::command]
pub fn codex_default_workspace(window: WebviewWindow) -> HostResult<String> {
    require_main_window(&window)?;
    let path = std::env::temp_dir().join("tabs-codex-workspace");
    std::fs::create_dir_all(&path)
        .map_err(|_| HostError::new("internal", "Could not prepare the Codex workspace"))?;
    path.canonicalize()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|_| HostError::new("internal", "Could not resolve the Codex workspace"))
}

/// Read a user-attached text file only after resolving junctions and symlinks.
#[tauri::command]
pub async fn codex_read_scoped_text_file(
    window: WebviewWindow,
    workspace_root: String,
    path: String,
) -> HostResult<String> {
    require_main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = std::path::Path::new(&workspace_root)
            .canonicalize()
            .map_err(|_| HostError::new("invalid_argument", "Workspace root is unavailable"))?;
        let target = std::path::Path::new(&path)
            .canonicalize()
            .map_err(|_| HostError::new("not_found", "Attachment is unavailable"))?;
        if !root.is_dir() || !target.starts_with(&root) || target == root || !target.is_file() {
            return Err(HostError::new(
                "invalid_argument",
                "Attachment is outside the selected workspace",
            ));
        }
        let metadata = std::fs::metadata(&target)
            .map_err(|_| HostError::new("not_found", "Attachment is unavailable"))?;
        if metadata.len() > 32 * 1024 {
            return Err(HostError::new(
                "invalid_argument",
                "Attachment exceeds text limit",
            ));
        }
        let bytes = std::fs::read(&target)
            .map_err(|_| HostError::new("internal", "Attachment could not be read"))?;
        if bytes.len() > 32 * 1024 {
            return Err(HostError::new(
                "invalid_argument",
                "Attachment exceeds text limit",
            ));
        }
        String::from_utf8(bytes)
            .map_err(|_| HostError::new("invalid_argument", "Attachment is not UTF-8 text"))
    })
    .await
    .map_err(|_| join_error())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedDocument {
    path: String,
    name: String,
    relative_path: String,
    size: u64,
}

fn list_scoped_documents(workspace_root: &str) -> HostResult<Vec<ScopedDocument>> {
    let root = std::path::Path::new(workspace_root)
        .canonicalize()
        .map_err(|_| HostError::new("invalid_argument", "Workspace root is unavailable"))?;
    if !root.is_dir() {
        return Err(HostError::new(
            "invalid_argument",
            "Workspace root is not a directory",
        ));
    }
    let mut pending = vec![(root.clone(), 0usize)];
    let mut scanned = 0usize;
    let mut documents = Vec::new();
    while let Some((directory, depth)) = pending.pop() {
        let entries = std::fs::read_dir(&directory)
            .map_err(|_| HostError::new("internal", "Could not list the selected workspace"))?;
        for entry in entries.flatten() {
            scanned += 1;
            if scanned > 4000 || documents.len() >= 50 {
                break;
            }
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist") {
                continue;
            }
            let Ok(resolved) = path.canonicalize() else {
                continue;
            };
            if !resolved.starts_with(&root) || resolved == root {
                continue;
            }
            let Ok(metadata) = std::fs::metadata(&resolved) else {
                continue;
            };
            if metadata.is_dir() {
                if depth < 4 {
                    pending.push((resolved, depth + 1));
                }
                continue;
            }
            if !metadata.is_file() || metadata.len() > 256 * 1024 {
                continue;
            }
            let supported = resolved
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|extension| {
                    matches!(
                        extension.to_ascii_lowercase().as_str(),
                        "md" | "markdown" | "txt" | "doc" | "docx"
                    )
                });
            if !supported {
                continue;
            }
            let relative_path = resolved
                .strip_prefix(&root)
                .unwrap_or(&resolved)
                .to_string_lossy()
                .replace('\\', "/");
            documents.push(ScopedDocument {
                path: resolved.to_string_lossy().into_owned(),
                name: name.to_owned(),
                relative_path,
                size: metadata.len(),
            });
        }
        if scanned > 4000 || documents.len() >= 50 {
            break;
        }
    }
    documents.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(documents)
}

#[tauri::command]
pub async fn codex_list_scoped_documents(
    window: WebviewWindow,
    workspace_root: String,
) -> HostResult<Vec<ScopedDocument>> {
    require_main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || list_scoped_documents(&workspace_root))
        .await
        .map_err(|_| join_error())?
}

#[derive(Serialize)]
pub struct ScopedDocumentWrite {
    path: String,
    sha256: String,
}

fn scoped_document_target(workspace_root: &str, file_name: &str) -> HostResult<std::path::PathBuf> {
    if file_name.is_empty()
        || file_name.len() > 120
        || file_name.starts_with('.')
        || file_name.ends_with(['.', ' '])
        || file_name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
        })
    {
        return Err(HostError::new(
            "invalid_argument",
            "Invalid document file name",
        ));
    }
    let path = std::path::Path::new(file_name);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "md" | "markdown" | "txt" | "docx") {
        return Err(HostError::new(
            "invalid_argument",
            "Unsupported document format",
        ));
    }
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim_end_matches(['.', ' '])
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
    {
        return Err(HostError::new(
            "invalid_argument",
            "Reserved document file name",
        ));
    }
    let root = std::path::Path::new(workspace_root)
        .canonicalize()
        .map_err(|_| HostError::new("invalid_argument", "Workspace root is unavailable"))?;
    if !root.is_dir() {
        return Err(HostError::new(
            "invalid_argument",
            "Workspace root is not a directory",
        ));
    }
    Ok(root.join(file_name))
}

fn scoped_document_hash(workspace_root: &str, file_name: &str) -> HostResult<Option<String>> {
    let target = scoped_document_target(workspace_root, file_name)?;
    let metadata = match std::fs::symlink_metadata(&target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(HostError::new("internal", "Could not inspect document")),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 256 * 1024 {
        return Err(HostError::new(
            "invalid_argument",
            "Document is not a supported regular file",
        ));
    }
    let resolved = target
        .canonicalize()
        .map_err(|_| HostError::new("internal", "Could not resolve document"))?;
    if resolved.parent() != target.parent() {
        return Err(HostError::new(
            "invalid_argument",
            "Document moved outside the selected folder",
        ));
    }
    let bytes = std::fs::read(&resolved)
        .map_err(|_| HostError::new("internal", "Could not read document"))?;
    if bytes.len() > 256 * 1024 {
        return Err(HostError::new(
            "invalid_argument",
            "Document exceeds size limit",
        ));
    }
    Ok(Some(format!("{:x}", Sha256::digest(&bytes))))
}

fn create_scoped_document(
    workspace_root: &str,
    file_name: &str,
    bytes: &[u8],
    expected_sha256: &str,
) -> HostResult<ScopedDocumentWrite> {
    let target = scoped_document_target(workspace_root, file_name)?;
    if bytes.len() > 256 * 1024 || format!("{:x}", Sha256::digest(bytes)) != expected_sha256 {
        return Err(HostError::new(
            "invalid_argument",
            "Document content hash or size is invalid",
        ));
    }
    let mut temporary = tempfile::NamedTempFile::new_in(target.parent().unwrap())
        .map_err(|_| HostError::new("internal", "Could not stage document"))?;
    temporary
        .write_all(bytes)
        .map_err(|_| HostError::new("internal", "Could not stage document content"))?;
    temporary.persist_noclobber(&target).map_err(|_| {
        HostError::new(
            "conflict",
            "Document already exists or could not be created",
        )
    })?;
    let resolved = target
        .canonicalize()
        .map_err(|_| HostError::new("internal", "Could not resolve created document"))?;
    Ok(ScopedDocumentWrite {
        path: resolved.to_string_lossy().into_owned(),
        sha256: expected_sha256.to_owned(),
    })
}

#[tauri::command]
pub async fn codex_scoped_document_hash(
    window: WebviewWindow,
    workspace_root: String,
    file_name: String,
) -> HostResult<Option<String>> {
    require_main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || scoped_document_hash(&workspace_root, &file_name))
        .await
        .map_err(|_| join_error())?
}

#[tauri::command]
pub async fn codex_create_scoped_document(
    window: WebviewWindow,
    workspace_root: String,
    file_name: String,
    content_base64: String,
    expected_sha256: String,
) -> HostResult<ScopedDocumentWrite> {
    require_main_window(&window)?;
    if content_base64.len() > 350_000 {
        return Err(HostError::new(
            "invalid_argument",
            "Document exceeds size limit",
        ));
    }
    let bytes = STANDARD
        .decode(content_base64)
        .map_err(|_| HostError::new("invalid_argument", "Document content is not valid base64"))?;
    tauri::async_runtime::spawn_blocking(move || {
        create_scoped_document(&workspace_root, &file_name, &bytes, &expected_sha256)
    })
    .await
    .map_err(|_| join_error())?
}

#[cfg(test)]
mod scoped_document_tests {
    use super::{create_scoped_document, list_scoped_documents, scoped_document_hash};
    use sha2::Digest;

    #[test]
    fn lists_only_supported_documents_under_the_selected_root() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("notes")).unwrap();
        std::fs::write(root.path().join("notes").join("one.md"), "one").unwrap();
        std::fs::write(root.path().join("other.exe"), "other").unwrap();
        let listed = list_scoped_documents(root.path().to_str().unwrap()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].relative_path, "notes/one.md");
    }

    #[test]
    fn creates_once_without_overwriting_and_checks_the_result_hash() {
        let root = tempfile::tempdir().unwrap();
        let hash = format!("{:x}", sha2::Sha256::digest(b"safe content"));
        let created = create_scoped_document(
            root.path().to_str().unwrap(),
            "note.md",
            b"safe content",
            &hash,
        )
        .unwrap();
        assert_eq!(created.sha256, hash);
        assert_eq!(
            scoped_document_hash(root.path().to_str().unwrap(), "note.md").unwrap(),
            Some(hash.clone())
        );
        assert!(create_scoped_document(
            root.path().to_str().unwrap(),
            "note.md",
            b"safe content",
            &hash
        )
        .is_err());
        assert_eq!(
            std::fs::read(root.path().join("note.md")).unwrap(),
            b"safe content"
        );
        assert!(create_scoped_document(
            root.path().to_str().unwrap(),
            "../other.md",
            b"safe content",
            &hash
        )
        .is_err());
    }
}

#[tauri::command]
pub async fn codex_read_thread(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    epoch: u64,
    thread_id: String,
) -> HostResult<Vec<NativeTurn>> {
    require_main_window(&window)?;
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.read_thread(epoch, &thread_id))
        .await
        .map_err(|_| join_error())?
}

#[tauri::command]
pub async fn codex_start_thread(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    request: ThreadRequest,
) -> HostResult<String> {
    require_main_window(&window)?;
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.start_thread(request))
        .await
        .map_err(|_| join_error())?
}

#[tauri::command]
pub async fn codex_resume_thread(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    epoch: u64,
    thread_id: String,
    tools: Vec<ToolSpec>,
) -> HostResult<String> {
    require_main_window(&window)?;
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.resume_thread(epoch, &thread_id, tools))
        .await
        .map_err(|_| join_error())?
}

#[tauri::command]
pub async fn codex_start_turn(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    request: TurnRequest,
) -> HostResult<String> {
    require_main_window(&window)?;
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.start_turn(request))
        .await
        .map_err(|_| join_error())?
}

#[tauri::command]
pub async fn codex_interrupt_turn(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    epoch: u64,
    thread_id: String,
    turn_id: String,
) -> HostResult<()> {
    require_main_window(&window)?;
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.interrupt_turn(epoch, &thread_id, &turn_id))
        .await
        .map_err(|_| join_error())?
}

#[tauri::command]
pub async fn codex_reply_request(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    epoch: u64,
    request_id: String,
    reply: RequestReply,
) -> HostResult<()> {
    require_main_window(&window)?;
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.reply_request(epoch, &request_id, reply))
        .await
        .map_err(|_| join_error())?
}

#[tauri::command]
pub fn codex_replay_events(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    epoch: u64,
    after_sequence: u64,
    limit: usize,
) -> HostResult<Replay> {
    require_main_window(&window)?;
    host.replay(epoch, after_sequence, limit)
}

#[tauri::command]
pub fn codex_ack_events(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    epoch: u64,
    sequence: u64,
) -> HostResult<()> {
    require_main_window(&window)?;
    host.ack_events(epoch, sequence)
}

#[tauri::command]
pub async fn codex_disconnect(
    window: WebviewWindow,
    host: State<'_, Arc<CodexHost>>,
    epoch: u64,
) -> HostResult<()> {
    require_main_window(&window)?;
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.disconnect_if_epoch(epoch))
        .await
        .map_err(|_| join_error())?
}
