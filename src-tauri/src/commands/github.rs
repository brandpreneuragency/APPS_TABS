use crate::github::{
    begin_device_flow, bind_device_code, bind_probed_user, cancel_targeted_flow,
    capture_device_poll, capture_pending_probe, capture_refresh, commit_pending_credential,
    credential_account_allowed, device_login_target, discard_targeted_pending,
    execute_transport_request, logout_auth, store_polled_pending, store_refreshed, AuthSecretStore,
    ACCESS_ACCOUNT, CACHE_ACCOUNT, DEVICE_LOGIN_URL,
};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

static SESSION_GENERATION: AtomicU64 = AtomicU64::new(1);
static AUTH_GATE: std::sync::Mutex<crate::github::AuthGate> =
    std::sync::Mutex::new(crate::github::AuthGate::new());
static CACHE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn credential_error() -> String {
    "credential_storage_failed".into()
}

fn entry(app: &tauri::AppHandle, account: &str) -> Result<Entry, String> {
    Entry::new(&app.config().identifier, account).map_err(|_| credential_error())
}

fn store_secret(app: &tauri::AppHandle, account: &str, value: &str) -> Result<(), String> {
    entry(app, account)?
        .set_password(value)
        .map_err(|_| credential_error())
}

fn read_secret(app: &tauri::AppHandle, account: &str) -> Result<Option<String>, String> {
    match entry(app, account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(credential_error()),
    }
}

fn delete_secret(app: &tauri::AppHandle, account: &str) -> Result<(), String> {
    match entry(app, account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(credential_error()),
    }
}

struct KeyringSecretStore<'a> {
    app: &'a tauri::AppHandle,
}

impl AuthSecretStore for KeyringSecretStore<'_> {
    fn read(&self, account: &str) -> Result<Option<String>, String> {
        read_secret(self.app, account)
    }

    fn write(&mut self, account: &str, value: &str) -> Result<(), String> {
        store_secret(self.app, account, value)
    }

    fn delete(&mut self, account: &str) -> Result<(), String> {
        delete_secret(self.app, account)
    }
}

fn with_secrets<T>(
    app: &tauri::AppHandle,
    op: impl FnOnce(&mut crate::github::AuthGate, &mut dyn AuthSecretStore) -> Result<T, String>,
) -> Result<T, String> {
    let mut gate = AUTH_GATE.lock().map_err(|_| credential_error())?;
    let mut secrets = KeyringSecretStore { app };
    op(&mut gate, &mut secrets)
}

#[tauri::command]
pub fn github_credential_status(app: tauri::AppHandle, account: String) -> Result<bool, String> {
    if !credential_account_allowed(&account) {
        return Err("credential_account_rejected".into());
    }
    Ok(read_secret(&app, &account)?.is_some())
}

#[tauri::command]
pub fn github_credential_put(
    _app: tauri::AppHandle,
    _account: String,
    _value: String,
) -> Result<(), String> {
    Err("credential_webview_write_rejected".into())
}

#[tauri::command]
pub fn github_credential_delete(app: tauri::AppHandle, account: String) -> Result<(), String> {
    if !credential_account_allowed(&account) {
        return Err("credential_account_rejected".into());
    }
    delete_secret(&app, &account)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubTransportCall {
    pub method: String,
    pub url: String,
    pub timeout_ms: u64,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub auth: String,
    #[serde(default)]
    pub body_encoding: String,
    #[serde(default)]
    pub accept: String,
    #[serde(default)]
    pub content_type: String,
    #[serde(default)]
    pub api_version: String,
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub caller_epoch: Option<u64>,
    #[serde(default)]
    pub authority_token: String,
}

#[tauri::command]
pub async fn github_transport_request(
    app: tauri::AppHandle,
    request: GithubTransportCall,
) -> Result<crate::github::NativeHttpResponse, String> {
    let generation = SESSION_GENERATION.load(Ordering::SeqCst);
    let bearer = if request.auth == "bearer" {
        Some(read_secret(&app, ACCESS_ACCOUNT)?.ok_or_else(|| "signed_out".to_string())?)
    } else {
        None
    };
    let bytes = if request.body_encoding == "base64" {
        base64::engine::general_purpose::STANDARD
            .decode(request.body.as_bytes())
            .map_err(|_| "validation".to_string())?
    } else {
        request.body.into_bytes()
    };
    let authority_token = if request.authority_token.is_empty() {
        None
    } else {
        Some(request.authority_token.as_str())
    };
    if crate::github::write_authority_stale(authority_token, request.caller_epoch) {
        return Err("stale_session".into());
    }
    if SESSION_GENERATION.load(Ordering::SeqCst) != generation {
        return Err("stale_session".into());
    }
    let accept = first_header(&request.accept, &request.headers, "accept");
    let content_type = first_header(&request.content_type, &request.headers, "content-type");
    let api_version = first_header(
        &request.api_version,
        &request.headers,
        "x-github-api-version",
    );
    if request.headers.keys().any(|key| {
        let name = key.to_ascii_lowercase();
        name == "authorization" || name == "cookie"
    }) {
        return Err("token_leak_rejected".into());
    }
    let response = execute_transport_request(
        &request.method,
        &request.url,
        &bytes,
        &request.auth,
        bearer.as_deref(),
        request.timeout_ms,
        crate::github::TransportMedia {
            accept: accept.as_deref(),
            content_type: content_type.as_deref(),
            api_version: api_version.as_deref(),
            captured_generation: generation,
            caller_epoch: request.caller_epoch,
            authority_token,
        },
        &|| SESSION_GENERATION.load(Ordering::SeqCst) == generation,
    )
    .await?;
    if SESSION_GENERATION.load(Ordering::SeqCst) != generation
        || crate::github::write_authority_stale(authority_token, request.caller_epoch)
    {
        return Err("stale_session".into());
    }
    Ok(response)
}

fn first_header(
    explicit: &str,
    headers: &std::collections::BTreeMap<String, String>,
    name: &str,
) -> Option<String> {
    if !explicit.is_empty() {
        return Some(explicit.to_string());
    }
    headers.iter().find_map(|(key, value)| {
        if key.eq_ignore_ascii_case(name) && !value.is_empty() {
            Some(value.clone())
        } else {
            None
        }
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteAuthorityPublic {
    pub epoch: u64,
    pub token: String,
}

#[tauri::command]
pub fn github_allocate_write_authority() -> Result<WriteAuthorityPublic, String> {
    let authority = crate::github::allocate_write_authority()?;
    Ok(WriteAuthorityPublic {
        epoch: authority.epoch,
        token: authority.token,
    })
}

#[tauri::command]
pub fn github_current_write_authority() -> Result<WriteAuthorityPublic, String> {
    let authority = crate::github::current_write_authority()?;
    Ok(WriteAuthorityPublic {
        epoch: authority.epoch,
        token: authority.token,
    })
}

#[tauri::command]
pub fn github_note_write_epoch(epoch: u64, token: String) -> Result<(), String> {
    crate::github::note_write_authority(&token, epoch)
}

#[tauri::command]
pub fn github_session_generation() -> u64 {
    SESSION_GENERATION.load(Ordering::SeqCst)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStartPublic {
    pub user_code: String,
    pub expires_in: u64,
    pub interval_seconds: u64,
    pub flow_id: String,
}

fn scope_allowed(scope: &str) -> bool {
    matches!(scope, "repo" | "repo delete_repo")
}

fn client_id_allowed(client_id: &str) -> bool {
    let trimmed = client_id.trim();
    trimmed == client_id
        && (8..=100).contains(&trimmed.len())
        && trimmed
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        && !trimmed.to_ascii_lowercase().contains("secret")
        && !trimmed.to_ascii_lowercase().starts_with("gho_")
}

#[tauri::command]
pub async fn github_device_start(
    app: tauri::AppHandle,
    client_id: String,
    scope: String,
    account_id: Option<String>,
) -> Result<DeviceStartPublic, String> {
    if !client_id_allowed(&client_id) || !scope_allowed(&scope) {
        return Err("invalid_client_id".into());
    }
    let elevated = scope.split([' ', ',']).any(|item| item == "delete_repo");
    let account_for_elevation = account_id.clone();
    let stamp = with_secrets(&app, |gate, secrets| {
        let stamp = begin_device_flow(gate, secrets)?;
        if elevated {
            let account = account_for_elevation
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "account_mismatch".to_string())?;
            if !gate.note_elevation(&stamp, &account) {
                return Err("stale_auth".into());
            }
        }
        Ok(stamp)
    })?;
    let body = format!(
        "client_id={}&scope={}",
        urlencoding(&client_id),
        urlencoding(&scope)
    );
    let response = oauth_post("https://github.com/login/device/code", &body).await?;
    let user_code = json_string(&response, "user_code").ok_or_else(|| "validation".to_string())?;
    let device_code =
        json_string(&response, "device_code").ok_or_else(|| "validation".to_string())?;
    if let Some(uri) = json_string(&response, "verification_uri") {
        if uri != DEVICE_LOGIN_URL {
            return Err("host_rejected".into());
        }
    }
    with_secrets(&app, |gate, secrets| {
        bind_device_code(gate, secrets, &stamp, &device_code)
    })?;
    Ok(DeviceStartPublic {
        user_code,
        expires_in: json_number(&response, "expires_in").unwrap_or(900),
        interval_seconds: json_number(&response, "interval").unwrap_or(5),
        flow_id: stamp.flow_token,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePollPublic {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
}

#[tauri::command]
pub async fn github_device_poll(
    app: tauri::AppHandle,
    client_id: String,
    flow_id: String,
) -> Result<DevicePollPublic, String> {
    if !client_id_allowed(&client_id) {
        return Err("invalid_client_id".into());
    }
    let (stamp, device_code) = with_secrets(&app, |gate, secrets| {
        capture_device_poll(gate, secrets, &flow_id)
    })?;
    let body = format!(
        "client_id={}&device_code={}&grant_type=urn:ietf:params:oauth:grant-type:device_code",
        urlencoding(&client_id),
        urlencoding(&device_code)
    );
    let response = oauth_post("https://github.com/login/oauth/access_token", &body).await?;
    with_secrets(&app, |gate, _secrets| {
        if gate.current(&stamp) {
            Ok(())
        } else {
            Err("stale_auth".into())
        }
    })?;
    if let Some(error) = json_string(&response, "error") {
        return Ok(match error.as_str() {
            "authorization_pending" => DevicePollPublic {
                status: "pending".into(),
                interval_seconds: None,
                scopes: None,
                expires_in: None,
            },
            "slow_down" => DevicePollPublic {
                status: "slow_down".into(),
                interval_seconds: json_number(&response, "interval"),
                scopes: None,
                expires_in: None,
            },
            "access_denied" => DevicePollPublic {
                status: "denied".into(),
                interval_seconds: None,
                scopes: None,
                expires_in: None,
            },
            "expired_token" => DevicePollPublic {
                status: "expired".into(),
                interval_seconds: None,
                scopes: None,
                expires_in: None,
            },
            "device_flow_disabled" => DevicePollPublic {
                status: "disabled".into(),
                interval_seconds: None,
                scopes: None,
                expires_in: None,
            },
            _ => DevicePollPublic {
                status: "error".into(),
                interval_seconds: None,
                scopes: None,
                expires_in: None,
            },
        });
    }
    let access =
        json_string(&response, "access_token").ok_or_else(|| "auth_expired".to_string())?;
    let refresh = json_string(&response, "refresh_token");
    with_secrets(&app, |gate, secrets| {
        store_polled_pending(gate, secrets, &stamp, &access, refresh.as_deref())
    })?;
    let scopes = json_string(&response, "scope")
        .unwrap_or_default()
        .split([',', ' '])
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect();
    Ok(DevicePollPublic {
        status: "authorized".into(),
        interval_seconds: None,
        scopes: Some(scopes),
        expires_in: json_number(&response, "expires_in"),
    })
}

#[tauri::command]
pub fn github_device_cancel(app: tauri::AppHandle, flow_id: String) -> Result<(), String> {
    with_secrets(&app, |gate, secrets| {
        cancel_targeted_flow(gate, secrets, &flow_id)
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUserPublic {
    pub id: String,
    pub login: String,
    pub scopes: Vec<String>,
    pub flow_id: String,
}

#[tauri::command]
pub async fn github_auth_probe_pending(
    app: tauri::AppHandle,
    flow_id: String,
) -> Result<PendingUserPublic, String> {
    let generation = SESSION_GENERATION.load(Ordering::SeqCst);
    let (stamp, token) = with_secrets(&app, |gate, secrets| {
        capture_pending_probe(gate, secrets, &flow_id)
    })?;
    let response = execute_transport_request(
        "GET",
        "https://api.github.com/user",
        b"",
        "bearer",
        Some(&token),
        20_000,
        crate::github::TransportMedia {
            accept: Some("application/vnd.github+json"),
            content_type: None,
            api_version: Some("2022-11-28"),
            captured_generation: generation,
            caller_epoch: None,
            authority_token: None,
        },
        &|| SESSION_GENERATION.load(Ordering::SeqCst) == generation,
    )
    .await?;
    if SESSION_GENERATION.load(Ordering::SeqCst) != generation {
        return Err("stale_auth".into());
    }
    if response.status != 200 {
        return Err("auth_expired".into());
    }
    let id = json_number(&response.body_text, "id")
        .ok_or_else(|| "personal_account_required".to_string())?;
    let login = json_string(&response.body_text, "login")
        .ok_or_else(|| "personal_account_required".to_string())?;
    let scopes: Vec<String> = response
        .headers
        .get("x-oauth-scopes")
        .cloned()
        .unwrap_or_default()
        .split([',', ' '])
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect();
    with_secrets(&app, |gate, _secrets| {
        bind_probed_user(gate, &stamp, &id.to_string(), &scopes)
    })?;
    Ok(PendingUserPublic {
        id: id.to_string(),
        login,
        scopes,
        flow_id: stamp.flow_token,
    })
}

#[tauri::command]
pub fn github_auth_commit_pending(
    app: tauri::AppHandle,
    flow_id: String,
    account_key: String,
) -> Result<(), String> {
    with_secrets(&app, |gate, secrets| {
        commit_pending_credential(gate, secrets, &flow_id, &account_key)
    })
}

#[tauri::command]
pub fn github_auth_discard_pending(app: tauri::AppHandle, flow_id: String) -> Result<(), String> {
    with_secrets(&app, |gate, secrets| {
        discard_targeted_pending(gate, secrets, &flow_id)
    })
}

#[tauri::command]
pub fn github_auth_has_access(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(read_secret(&app, ACCESS_ACCOUNT)?.is_some())
}

#[tauri::command]
pub fn github_auth_logout(app: tauri::AppHandle) -> Result<(), String> {
    with_secrets(&app, |gate, secrets| {
        logout_auth(gate, secrets)?;
        SESSION_GENERATION.fetch_add(1, Ordering::SeqCst);
        Ok(())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshPublic {
    pub scopes: Vec<String>,
    pub expires_in: Option<u64>,
}

#[tauri::command]
pub async fn github_auth_refresh(
    app: tauri::AppHandle,
    client_id: String,
) -> Result<Option<RefreshPublic>, String> {
    if !client_id_allowed(&client_id) {
        return Err("invalid_client_id".into());
    }
    let (stamp, refresh) = with_secrets(&app, |gate, secrets| capture_refresh(gate, secrets))?;
    let Some(refresh) = refresh else {
        return Ok(None);
    };
    let body = format!(
        "client_id={}&grant_type=refresh_token&refresh_token={}",
        urlencoding(&client_id),
        urlencoding(&refresh)
    );
    let response = oauth_post("https://github.com/login/oauth/access_token", &body).await?;
    let Some(access) = json_string(&response, "access_token") else {
        return Ok(None);
    };
    let next = json_string(&response, "refresh_token");
    with_secrets(&app, |gate, secrets| {
        store_refreshed(gate, secrets, &stamp, &access, next.as_deref())
    })?;
    let scopes = json_string(&response, "scope")
        .unwrap_or_default()
        .split([',', ' '])
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect();
    Ok(Some(RefreshPublic {
        scopes,
        expires_in: json_number(&response, "expires_in"),
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SealedCache {
    pub iv: String,
    pub ciphertext: String,
}

fn cache_key(app: &tauri::AppHandle) -> Result<[u8; 32], String> {
    let _guard = CACHE_LOCK.lock().map_err(|_| credential_error())?;
    if let Some(existing) = read_secret(app, CACHE_ACCOUNT)? {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(existing)
            .map_err(|_| credential_error())?;
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }
    let mut key = [0u8; 32];
    getrandom::getrandom(&mut key).map_err(|_| credential_error())?;
    store_secret(
        app,
        CACHE_ACCOUNT,
        &base64::engine::general_purpose::STANDARD.encode(key),
    )?;
    Ok(key)
}

#[tauri::command]
pub fn github_cache_seal(app: tauri::AppHandle, plaintext: String) -> Result<SealedCache, String> {
    let key = cache_key(&app)?;
    let cipher = Aes256Gcm::new((&key).into());
    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).map_err(|_| "cache_nonce_failed".to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let encrypted = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| "cache_seal_failed".to_string())?;
    Ok(SealedCache {
        iv: base64::engine::general_purpose::STANDARD.encode(nonce_bytes),
        ciphertext: base64::engine::general_purpose::STANDARD.encode(encrypted),
    })
}

#[tauri::command]
pub fn github_cache_open(
    app: tauri::AppHandle,
    iv: String,
    ciphertext: String,
) -> Result<String, String> {
    let key = cache_key(&app)?;
    let cipher = Aes256Gcm::new((&key).into());
    let nonce_bytes = base64::engine::general_purpose::STANDARD
        .decode(iv)
        .map_err(|_| "persistence".to_string())?;
    if !crate::github::cache_nonce_acceptable(nonce_bytes.len()) {
        return Err("persistence".into());
    }
    let encrypted = base64::engine::general_purpose::STANDARD
        .decode(ciphertext)
        .map_err(|_| "persistence".to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plain = cipher
        .decrypt(nonce, encrypted.as_ref())
        .map_err(|_| "persistence".to_string())?;
    String::from_utf8(plain).map_err(|_| "persistence".to_string())
}

#[tauri::command]
pub fn github_open_device_login() -> Result<(), String> {
    if device_login_target() != DEVICE_LOGIN_URL {
        return Err("host_rejected".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", DEVICE_LOGIN_URL])
            .spawn()
            .map_err(|_| "device_browser_failed".to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("device_browser_windows_only".into())
    }
}

async fn oauth_post(url: &str, body: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .user_agent("TABS")
        .build()
        .map_err(|_| "github_unavailable".to_string())?;
    let response = client
        .post(url)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| "github_unavailable".to_string())?;
    if response.status().is_redirection() {
        return Err("redirect_rejected".into());
    }
    let text = response
        .text()
        .await
        .map_err(|_| "github_unavailable".to_string())?;
    Ok(text)
}

fn json_string(body: &str, key: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(body).ok()?;
    parsed.get(key)?.as_str().map(str::to_string)
}

fn json_number(body: &str, key: &str) -> Option<u64> {
    let parsed: serde_json::Value = serde_json::from_str(body).ok()?;
    parsed.get(key)?.as_u64()
}

fn urlencoding(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}
