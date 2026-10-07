//! Host, redirect, credential-redaction, pagination, and rate-limit rules for
//! the GitHub native boundary. HTTP execution is intentionally not linked here.

pub const ACCESS_ACCOUNT: &str = "github.oauth.access";
pub const REFRESH_ACCOUNT: &str = "github.oauth.refresh";
pub const CACHE_ACCOUNT: &str = "github.cache-key";
pub const DEVICE_ACCOUNT: &str = "github.oauth.device";
pub const PENDING_ACCESS_ACCOUNT: &str = "github.oauth.access.pending";
pub const PENDING_REFRESH_ACCOUNT: &str = "github.oauth.refresh.pending";

pub fn credential_account_allowed(account: &str) -> bool {
    matches!(account, ACCESS_ACCOUNT | REFRESH_ACCOUNT | CACHE_ACCOUNT)
}

pub fn redact_secret(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let lower = text.to_ascii_lowercase();
    let markers = [
        "gho_",
        "ghu_",
        "ghs_",
        "ghr_",
        "ghp_",
        "github_pat_",
        "bearer ",
        "access_token=",
        "refresh_token=",
        "device_code=",
        "client_secret=",
    ];
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let rest = &lower[index..];
        if let Some(marker) = markers.iter().find(|marker| rest.starts_with(*marker)) {
            out.push_str("[redacted]");
            let mut end = index + marker.len();
            while end < bytes.len() && bytes[end].is_ascii_alphanumeric() {
                end += 1;
            }
            index = end;
            continue;
        }
        out.push(text[index..].chars().next().unwrap_or(' '));
        index += text[index..].chars().next().unwrap_or(' ').len_utf8();
    }
    out
}

pub fn validate_github_request(method: &str, url: &str, body: &str) -> Result<(), &'static str> {
    if url_contains_credential(url) || body_contains_credential(body) {
        return Err("token_leak_rejected");
    }
    if body_forces_update(body) {
        return Err("force_rejected");
    }
    let Some((scheme, rest)) = url.split_once("://") else {
        return Err("host_rejected");
    };
    if scheme != "https" || rest.contains('@') {
        return Err("host_rejected");
    }
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    if host.contains(':') {
        return Err("host_rejected");
    }
    let (path, query) = path.split_once('?').unwrap_or((path, ""));
    if path
        .split('/')
        .any(|segment| segment == "." || segment == "..")
    {
        return Err("host_rejected");
    }
    if host == "github.com" {
        if method == "GET" && is_receive_pack_info(path, query) {
            return Ok(());
        }
        if method == "POST" && is_receive_pack_post(path, query) {
            return Ok(());
        }
        if method != "POST"
            || (path != "login/device/code" && path != "login/oauth/access_token")
            || !query.is_empty()
        {
            return Err("host_rejected");
        }
        return Ok(());
    }
    if host != "api.github.com" || !api_request_allowed(method, path) {
        return Err("host_rejected");
    }
    if query.split('&').any(|pair| {
        let key = pair.split('=').next().unwrap_or("");
        !matches!(
            key,
            "" | "affiliation"
                | "per_page"
                | "page"
                | "visibility"
                | "ref"
                | "sort"
                | "direction"
                | "sha"
                | "recursive"
                | "path"
        )
    }) {
        return Err("token_leak_rejected");
    }
    Ok(())
}

fn body_forces_update(body: &str) -> bool {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        return value.get("force").and_then(|item| item.as_bool()) == Some(true);
    }
    body.split('&').any(|pair| pair == "force=true")
}

fn body_contains_credential(body: &str) -> bool {
    if body.split('&').any(|pair| {
        let key = pair.split('=').next().unwrap_or("").to_ascii_lowercase();
        key == "client_secret" || key == "access_token" || key == "refresh_token"
    }) {
        return true;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return false;
    };
    let Some(object) = value.as_object() else {
        return false;
    };
    object.keys().any(|key| {
        let normalized: String = key.chars().filter(|ch| *ch != '_' && *ch != '-').collect();
        normalized.eq_ignore_ascii_case("clientsecret")
            || normalized.eq_ignore_ascii_case("accesstoken")
            || normalized.eq_ignore_ascii_case("refreshtoken")
    })
}

fn url_contains_credential(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if ["gho_", "ghr_", "github_pat_"]
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return true;
    }
    let query = lower.split_once('?').map(|(_, query)| query).unwrap_or("");
    [
        "access_token",
        "refresh_token",
        "device_code",
        "client_secret",
    ]
    .iter()
    .any(|marker| query.contains(marker))
}

fn is_receive_pack_info(path: &str, query: &str) -> bool {
    let Some(repo) = path.strip_suffix(".git/info/refs") else {
        return false;
    };
    git_repo_path(repo) && query == "service=git-receive-pack"
}

fn is_receive_pack_post(path: &str, query: &str) -> bool {
    let Some(repo) = path.strip_suffix(".git/git-receive-pack") else {
        return false;
    };
    git_repo_path(repo) && query.is_empty()
}

fn git_repo_path(path: &str) -> bool {
    let mut parts = path.split('/');
    let Some(owner) = parts.next() else {
        return false;
    };
    let Some(repo) = parts.next() else {
        return false;
    };
    parts.next().is_none() && safe_segment(owner) && safe_segment(repo)
}

fn safe_segment(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn api_request_allowed(method: &str, path: &str) -> bool {
    if method == "GET"
        && (path == "user"
            || path == "user/repos"
            || path == "gitignore/templates"
            || path == "licenses")
    {
        return true;
    }
    if method == "GET"
        && (path.starts_with("gitignore/templates/") || path.starts_with("licenses/"))
    {
        let rest = path
            .split_once('/')
            .and_then(|(_, rest)| rest.split_once('/'))
            .map(|(_, name)| name)
            .unwrap_or("");
        return !rest.is_empty() && !rest.contains('/') && safe_segment(rest);
    }
    if method == "POST" && path == "user/repos" {
        return true;
    }
    if method == "GET" {
        if let Some(id) = path.strip_prefix("repositories/") {
            return !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit());
        }
    }
    let mut parts = path.split('/');
    if parts.next() != Some("repos") {
        return false;
    }
    let Some(owner) = parts.next() else {
        return false;
    };
    let Some(repo) = parts.next() else {
        return false;
    };
    if !safe_segment(owner) || !safe_segment(repo) {
        return false;
    }
    let rest = parts.collect::<Vec<_>>().join("/");
    match method {
        "GET" => {
            rest.is_empty()
                || rest == "branches"
                || rest.starts_with("branches/")
                || rest == "contents"
                || rest.starts_with("contents/")
                || rest == "commits"
                || rest.starts_with("commits/")
                || rest.starts_with("git/commits/")
                || rest.starts_with("git/trees/")
                || rest.starts_with("git/blobs/")
                || rest.starts_with("git/ref/")
                || rest.starts_with("git/refs/")
        }
        "POST" => matches!(
            rest.as_str(),
            "git/blobs" | "git/trees" | "git/commits" | "git/refs"
        ),
        "PATCH" => rest.starts_with("git/refs/"),
        "PUT" => rest.starts_with("contents/"),
        "DELETE" => rest.is_empty(),
        _ => false,
    }
}

pub fn next_link(header: &str) -> Option<&str> {
    header.split(',').find_map(|part| {
        let start = part.find('<')? + 1;
        let end = part.find('>')?;
        if part.contains("rel=\"next\"") {
            Some(&part[start..end])
        } else {
            None
        }
    })
}

pub fn rate_limited(status: u16, remaining: Option<&str>, retry_after: Option<&str>) -> bool {
    status == 429
        || ((status == 403 || status == 429) && (remaining == Some("0") || retry_after.is_some()))
}

pub const DEVICE_LOGIN_URL: &str = "https://github.com/login/device";
pub const MAX_RESPONSE_BYTES: usize = 8_000_000;
pub const MAX_REQUEST_BYTES: usize = 20_000_000;

pub fn device_login_target() -> &'static str {
    DEVICE_LOGIN_URL
}

pub fn prepare_transport(
    method: &str,
    url: &str,
    body: &str,
    auth: &str,
) -> Result<(), &'static str> {
    validate_github_request(method, url, body)?;
    if auth != "none" && auth != "bearer" {
        return Err("token_leak_rejected");
    }
    if url.contains("login/oauth/access_token") || url.contains("login/device/code") {
        return Err("oauth_secret_endpoint_refused");
    }
    if body.len() > MAX_REQUEST_BYTES {
        return Err("too_large");
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHttpResponse {
    pub status: u16,
    pub headers: std::collections::BTreeMap<String, String>,
    pub body_text: String,
    pub body_base64: Option<String>,
}

pub struct TransportMedia<'a> {
    pub accept: Option<&'a str>,
    pub content_type: Option<&'a str>,
    pub api_version: Option<&'a str>,
    pub captured_generation: u64,
    pub caller_epoch: Option<u64>,
    pub authority_token: Option<&'a str>,
}

pub fn accept_safe_media(
    accept: Option<&str>,
    content_type: Option<&str>,
    api_version: Option<&str>,
) -> Result<(), &'static str> {
    if let Some(value) = accept {
        if !matches!(
            value,
            "application/vnd.github+json"
                | "application/vnd.github.raw+json"
                | "application/x-git-receive-pack-result"
                | "application/json"
        ) {
            return Err("host_rejected");
        }
    }
    if let Some(value) = content_type {
        if !matches!(
            value,
            "application/json" | "application/x-git-receive-pack-request"
        ) {
            return Err("host_rejected");
        }
    }
    if let Some(value) = api_version {
        if value != "2022-11-28" {
            return Err("host_rejected");
        }
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WriteAuthority {
    pub epoch: u64,
    pub token: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WriteAuthorityGate {
    epoch: u64,
    token: String,
}

impl WriteAuthorityGate {
    pub const fn new() -> Self {
        Self {
            epoch: 0,
            token: String::new(),
        }
    }

    pub fn current(&self) -> WriteAuthority {
        WriteAuthority {
            epoch: self.epoch,
            token: self.token.clone(),
        }
    }

    pub fn allocate(&mut self) -> Result<WriteAuthority, &'static str> {
        self.epoch = self.epoch.saturating_add(1);
        self.token = opaque_token("gha")?;
        Ok(self.current())
    }

    pub fn note(&mut self, token: &str, epoch: u64) -> Result<(), &'static str> {
        if self.token.is_empty() || token != self.token || epoch < self.epoch {
            return Err("stale_session");
        }
        if epoch > self.epoch {
            self.epoch = epoch;
        }
        Ok(())
    }

    pub fn stale(&self, token: Option<&str>, epoch: Option<u64>) -> bool {
        if token.is_none() && epoch.is_none() {
            return false;
        }
        if self.token.is_empty() {
            return epoch.is_some_and(|value| value < self.epoch);
        }
        match (token, epoch) {
            (Some(token), Some(epoch)) => token != self.token || epoch < self.epoch,
            _ => true,
        }
    }
}

static WRITE_AUTHORITY: std::sync::Mutex<WriteAuthorityGate> =
    std::sync::Mutex::new(WriteAuthorityGate::new());

pub fn allocate_write_authority() -> Result<WriteAuthority, String> {
    WRITE_AUTHORITY
        .lock()
        .map_err(|_| "stale_session".to_string())?
        .allocate()
        .map_err(str::to_string)
}

pub fn current_write_authority() -> Result<WriteAuthority, String> {
    Ok(WRITE_AUTHORITY
        .lock()
        .map_err(|_| "stale_session".to_string())?
        .current())
}

pub fn note_write_authority(token: &str, epoch: u64) -> Result<(), String> {
    WRITE_AUTHORITY
        .lock()
        .map_err(|_| "stale_session".to_string())?
        .note(token, epoch)
        .map_err(str::to_string)
}

pub fn write_authority_stale(token: Option<&str>, epoch: Option<u64>) -> bool {
    WRITE_AUTHORITY
        .lock()
        .map(|state| state.stale(token, epoch))
        .unwrap_or(true)
}

pub fn cache_nonce_acceptable(len: usize) -> bool {
    len == 12
}

fn opaque_token(prefix: &str) -> Result<String, &'static str> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|_| "credential_storage_failed")?;
    let mut out = String::with_capacity(prefix.len() + 33);
    out.push_str(prefix);
    out.push('.');
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(out)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthStamp {
    pub generation: u64,
    pub flow_id: u64,
    pub flow_token: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthGate {
    generation: u64,
    flow_id: u64,
    flow_token: String,
    pending_account: Option<String>,
    pending_scopes: Vec<String>,
    elevation_account: Option<String>,
    probed: bool,
    device_bound: bool,
    pending_bound: bool,
}

impl AuthGate {
    pub const fn new() -> Self {
        Self {
            generation: 1,
            flow_id: 0,
            flow_token: String::new(),
            pending_account: None,
            pending_scopes: Vec::new(),
            elevation_account: None,
            probed: false,
            device_bound: false,
            pending_bound: false,
        }
    }

    pub fn stamp(&self) -> AuthStamp {
        AuthStamp {
            generation: self.generation,
            flow_id: self.flow_id,
            flow_token: self.flow_token.clone(),
        }
    }

    pub fn begin_flow(&mut self) -> Result<AuthStamp, &'static str> {
        self.flow_id = self.flow_id.wrapping_add(1);
        self.flow_token = opaque_token("flow")?;
        self.clear_flow_binding();
        self.elevation_account = None;
        Ok(self.stamp())
    }

    pub fn invalidate(&mut self) -> Result<(), &'static str> {
        self.generation = self.generation.wrapping_add(1);
        self.flow_id = self.flow_id.wrapping_add(1);
        self.flow_token = opaque_token("flow")?;
        self.clear_flow_binding();
        self.elevation_account = None;
        Ok(())
    }

    fn end_flow(&mut self) -> Result<(), &'static str> {
        self.flow_id = self.flow_id.wrapping_add(1);
        self.flow_token = opaque_token("flow")?;
        self.clear_flow_binding();
        self.elevation_account = None;
        Ok(())
    }

    fn clear_flow_binding(&mut self) {
        self.pending_account = None;
        self.pending_scopes.clear();
        self.probed = false;
        self.device_bound = false;
        self.pending_bound = false;
    }

    pub fn current(&self, stamp: &AuthStamp) -> bool {
        !self.flow_token.is_empty()
            && self.generation == stamp.generation
            && self.flow_id == stamp.flow_id
            && self.flow_token == stamp.flow_token
    }

    pub fn may_write_secret(&self, stamp: &AuthStamp) -> bool {
        self.current(stamp)
    }

    pub fn note_elevation(&mut self, stamp: &AuthStamp, account: &str) -> bool {
        if !self.current(stamp) || account.is_empty() {
            return false;
        }
        self.elevation_account = Some(account.to_string());
        true
    }

    pub fn may_commit_pending(
        &self,
        account: &str,
        delete_scope: bool,
    ) -> Result<(), &'static str> {
        if delete_scope {
            let elevation = self
                .elevation_account
                .as_deref()
                .ok_or("delete_scope_elevation_rejected")?;
            let pending = self
                .pending_account
                .as_deref()
                .ok_or("delete_scope_elevation_rejected")?;
            if elevation != account || pending != account {
                return Err("delete_scope_elevation_rejected");
            }
        }
        match self.pending_account.as_deref() {
            Some(bound) if bound == account => Ok(()),
            Some(_) => Err("account_mismatch"),
            None => Err("auth_expired"),
        }
    }

    pub fn elevation_account_bound(&self) -> bool {
        self.elevation_account.is_some()
    }

    pub fn bind_pending_account(&mut self, stamp: &AuthStamp, account: &str) -> bool {
        if !self.current(stamp) || account.is_empty() {
            return false;
        }
        self.pending_account = Some(account.to_string());
        true
    }

    fn mark_device_bound(&mut self, stamp: &AuthStamp) -> bool {
        if !self.current(stamp) {
            return false;
        }
        self.device_bound = true;
        true
    }

    fn mark_pending_bound(&mut self, stamp: &AuthStamp) -> bool {
        if !self.current(stamp) {
            return false;
        }
        self.pending_bound = true;
        true
    }
}

pub trait AuthSecretStore {
    fn read(&self, account: &str) -> Result<Option<String>, String>;
    fn write(&mut self, account: &str, value: &str) -> Result<(), String>;
    fn delete(&mut self, account: &str) -> Result<(), String>;
}

pub fn begin_device_flow(
    gate: &mut AuthGate,
    secrets: &mut dyn AuthSecretStore,
) -> Result<AuthStamp, String> {
    let stamp = gate.begin_flow().map_err(str::to_string)?;
    secrets.delete(DEVICE_ACCOUNT)?;
    secrets.delete(PENDING_ACCESS_ACCOUNT)?;
    secrets.delete(PENDING_REFRESH_ACCOUNT)?;
    Ok(stamp)
}

pub fn bind_device_code(
    gate: &mut AuthGate,
    secrets: &mut dyn AuthSecretStore,
    stamp: &AuthStamp,
    device_code: &str,
) -> Result<(), String> {
    if !gate.may_write_secret(stamp) {
        return Err("stale_auth".into());
    }
    secrets.write(DEVICE_ACCOUNT, device_code)?;
    if !gate.mark_device_bound(stamp) {
        let _ = secrets.delete(DEVICE_ACCOUNT);
        return Err("stale_auth".into());
    }
    Ok(())
}

pub fn capture_device_poll(
    gate: &AuthGate,
    secrets: &dyn AuthSecretStore,
    flow_token: &str,
) -> Result<(AuthStamp, String), String> {
    let stamp = gate.stamp();
    if stamp.flow_token != flow_token || !gate.current(&stamp) || !gate.device_bound {
        return Err("stale_auth".into());
    }
    let code = secrets
        .read(DEVICE_ACCOUNT)?
        .ok_or_else(|| "validation".to_string())?;
    Ok((stamp, code))
}

pub fn store_polled_pending(
    gate: &mut AuthGate,
    secrets: &mut dyn AuthSecretStore,
    stamp: &AuthStamp,
    access: &str,
    refresh: Option<&str>,
) -> Result<(), String> {
    if !gate.may_write_secret(stamp) {
        return Err("stale_auth".into());
    }
    secrets.write(PENDING_ACCESS_ACCOUNT, access)?;
    if let Some(refresh) = refresh {
        secrets.write(PENDING_REFRESH_ACCOUNT, refresh)?;
    } else {
        secrets.delete(PENDING_REFRESH_ACCOUNT)?;
    }
    secrets.delete(DEVICE_ACCOUNT)?;
    if !gate.mark_pending_bound(stamp) {
        let _ = secrets.delete(PENDING_ACCESS_ACCOUNT);
        let _ = secrets.delete(PENDING_REFRESH_ACCOUNT);
        return Err("stale_auth".into());
    }
    Ok(())
}

pub fn capture_pending_probe(
    gate: &AuthGate,
    secrets: &dyn AuthSecretStore,
    flow_token: &str,
) -> Result<(AuthStamp, String), String> {
    let stamp = gate.stamp();
    if stamp.flow_token != flow_token || !gate.current(&stamp) || !gate.pending_bound {
        return Err("stale_auth".into());
    }
    let token = secrets
        .read(PENDING_ACCESS_ACCOUNT)?
        .ok_or_else(|| "auth_expired".to_string())?;
    Ok((stamp, token))
}

pub fn bind_probed_user(
    gate: &mut AuthGate,
    stamp: &AuthStamp,
    account: &str,
    scopes: &[String],
) -> Result<(), String> {
    if !gate.bind_pending_account(stamp, account) {
        return Err("stale_auth".into());
    }
    if !scopes.iter().any(|scope| scope == "repo") {
        gate.pending_account = None;
        gate.probed = false;
        return Err("insufficient_scope".into());
    }
    gate.pending_scopes = scopes.to_vec();
    gate.probed = true;
    Ok(())
}

fn clear_pending_secrets(
    gate: &mut AuthGate,
    secrets: &mut dyn AuthSecretStore,
) -> Result<(), String> {
    secrets.delete(PENDING_ACCESS_ACCOUNT)?;
    secrets.delete(PENDING_REFRESH_ACCOUNT)?;
    gate.pending_account = None;
    gate.pending_scopes.clear();
    gate.probed = false;
    gate.pending_bound = false;
    Ok(())
}

pub fn commit_pending_credential(
    gate: &mut AuthGate,
    secrets: &mut dyn AuthSecretStore,
    flow_token: &str,
    account_key: &str,
) -> Result<(), String> {
    let stamp = gate.stamp();
    if flow_token.is_empty() || stamp.flow_token != flow_token || !gate.current(&stamp) {
        return Err("stale_auth".into());
    }
    if !gate.probed || !gate.pending_bound {
        return Err("auth_expired".into());
    }
    let delete_scope = gate.elevation_account_bound();
    if delete_scope {
        let granted = gate.pending_scopes.clone();
        if !granted.iter().any(|scope| scope == "repo")
            || !granted.iter().any(|scope| scope == "delete_repo")
        {
            clear_pending_secrets(gate, secrets)?;
            return Err("delete_scope_elevation_rejected".into());
        }
    }
    if let Err(error) = gate.may_commit_pending(account_key, delete_scope) {
        clear_pending_secrets(gate, secrets)?;
        return Err(error.to_string());
    }
    let bound = gate
        .pending_account
        .clone()
        .ok_or_else(|| "auth_expired".to_string())?;
    if bound != account_key {
        clear_pending_secrets(gate, secrets)?;
        return Err("account_mismatch".into());
    }
    let access = secrets
        .read(PENDING_ACCESS_ACCOUNT)?
        .ok_or_else(|| "auth_expired".to_string())?;
    secrets.write(ACCESS_ACCOUNT, &access)?;
    if let Some(refresh) = secrets.read(PENDING_REFRESH_ACCOUNT)? {
        secrets.write(REFRESH_ACCOUNT, &refresh)?;
    }
    clear_pending_secrets(gate, secrets)?;
    gate.elevation_account = None;
    Ok(())
}

pub fn cancel_targeted_flow(
    gate: &mut AuthGate,
    secrets: &mut dyn AuthSecretStore,
    flow_token: &str,
) -> Result<(), String> {
    if flow_token.is_empty() || gate.stamp().flow_token != flow_token {
        return Ok(());
    }
    secrets.delete(DEVICE_ACCOUNT)?;
    secrets.delete(PENDING_ACCESS_ACCOUNT)?;
    secrets.delete(PENDING_REFRESH_ACCOUNT)?;
    gate.end_flow().map_err(str::to_string)?;
    Ok(())
}

pub fn discard_targeted_pending(
    gate: &mut AuthGate,
    secrets: &mut dyn AuthSecretStore,
    flow_token: &str,
) -> Result<(), String> {
    if flow_token.is_empty() || gate.stamp().flow_token != flow_token {
        return Ok(());
    }
    secrets.delete(DEVICE_ACCOUNT)?;
    secrets.delete(PENDING_ACCESS_ACCOUNT)?;
    secrets.delete(PENDING_REFRESH_ACCOUNT)?;
    gate.end_flow().map_err(str::to_string)?;
    Ok(())
}

pub fn logout_auth(gate: &mut AuthGate, secrets: &mut dyn AuthSecretStore) -> Result<(), String> {
    let _ = gate.invalidate();
    for account in [
        ACCESS_ACCOUNT,
        REFRESH_ACCOUNT,
        CACHE_ACCOUNT,
        DEVICE_ACCOUNT,
        PENDING_ACCESS_ACCOUNT,
        PENDING_REFRESH_ACCOUNT,
    ] {
        secrets.delete(account)?;
    }
    Ok(())
}

pub fn capture_refresh(
    gate: &AuthGate,
    secrets: &dyn AuthSecretStore,
) -> Result<(AuthStamp, Option<String>), String> {
    Ok((gate.stamp(), secrets.read(REFRESH_ACCOUNT)?))
}

pub fn store_refreshed(
    gate: &AuthGate,
    secrets: &mut dyn AuthSecretStore,
    stamp: &AuthStamp,
    access: &str,
    refresh: Option<&str>,
) -> Result<(), String> {
    if !gate.may_write_secret(stamp) {
        return Err("stale_auth".into());
    }
    secrets.write(ACCESS_ACCOUNT, access)?;
    if let Some(refresh) = refresh {
        secrets.write(REFRESH_ACCOUNT, refresh)?;
    }
    Ok(())
}

pub async fn execute_transport_request(
    method: &str,
    url: &str,
    body: &[u8],
    auth: &str,
    bearer: Option<&str>,
    timeout_ms: u64,
    media: TransportMedia<'_>,
    session_current: &dyn Fn() -> bool,
) -> Result<NativeHttpResponse, String> {
    accept_safe_media(media.accept, media.content_type, media.api_version)
        .map_err(str::to_string)?;
    if body.len() > MAX_REQUEST_BYTES {
        return Err("too_large".into());
    }
    let text_body = std::str::from_utf8(body).unwrap_or("");
    let scan_body = media.content_type == Some("application/json")
        || text_body.trim_start().starts_with('{')
        || text_body.contains("client_secret=");
    prepare_transport(method, url, if scan_body { text_body } else { "" }, auth)
        .map_err(str::to_string)?;
    let timeout = timeout_ms.clamp(1_000, 60_000);
    let mut request = github_client(timeout)?
        .request(
            reqwest::Method::from_bytes(method.as_bytes())
                .map_err(|_| "host_rejected".to_string())?,
            url,
        )
        .timeout(std::time::Duration::from_millis(timeout));
    if auth == "bearer" {
        let token = bearer.ok_or_else(|| "signed_out".to_string())?;
        if url.starts_with("https://github.com/") && url.contains(".git/") {
            let encoded = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                format!("x-access-token:{token}"),
            );
            request = request.header("Authorization", format!("Basic {encoded}"));
        } else {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
    }
    if let Some(value) = media.accept {
        request = request.header("Accept", value);
    }
    if let Some(value) = media.content_type {
        request = request.header("Content-Type", value);
    }
    if let Some(value) = media.api_version {
        request = request.header("X-GitHub-Api-Version", value);
    }
    if !body.is_empty() {
        request = request.body(body.to_vec());
    }
    if !session_current() {
        return Err("stale_session".into());
    }
    if write_authority_stale(media.authority_token, media.caller_epoch) {
        return Err("stale_session".into());
    }
    let mut response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "timeout".to_string()
        } else {
            "github_unavailable".to_string()
        }
    })?;
    let status = response.status().as_u16();
    if matches!(status, 301 | 302 | 303 | 307 | 308) {
        return Err("redirect_rejected".into());
    }
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            let key = name.as_str().to_ascii_lowercase();
            if !matches!(
                key.as_str(),
                "content-type"
                    | "x-oauth-scopes"
                    | "x-accepted-oauth-scopes"
                    | "x-ratelimit-remaining"
                    | "x-ratelimit-limit"
                    | "retry-after"
                    | "link"
                    | "x-github-media-type"
            ) {
                return None;
            }
            Some((key, value.to_str().unwrap_or("").to_string()))
        })
        .collect();
    let mut limited = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if limited.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                    return Err("too_large".into());
                }
                limited.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(error) if error.is_timeout() => return Err("timeout".into()),
            Err(_) => return Err("github_unavailable".into()),
        }
    }
    let body_text = match std::str::from_utf8(&limited) {
        Ok(text) => text.to_string(),
        Err(_) => String::new(),
    };
    let body_base64 = Some(base64::engine::general_purpose::STANDARD.encode(&limited));
    Ok(NativeHttpResponse {
        status,
        headers,
        body_text,
        body_base64,
    })
}

fn github_client(timeout_ms: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .user_agent("TABS")
        .build()
        .map_err(|_| "github_unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::{
        begin_device_flow, bind_device_code, bind_probed_user, cache_nonce_acceptable,
        cancel_targeted_flow, capture_device_poll, capture_pending_probe, capture_refresh,
        commit_pending_credential, credential_account_allowed, device_login_target,
        discard_targeted_pending, logout_auth, next_link, prepare_transport, rate_limited,
        redact_secret, store_polled_pending, store_refreshed, validate_github_request, AuthGate,
        AuthSecretStore, WriteAuthorityGate, ACCESS_ACCOUNT, DEVICE_ACCOUNT,
        PENDING_ACCESS_ACCOUNT, PENDING_REFRESH_ACCOUNT, REFRESH_ACCOUNT,
    };

    #[test]
    fn allowlist_rejects_other_hosts_and_credential_urls() {
        assert!(
            validate_github_request("POST", "https://github.com/login/device/code", "").is_ok()
        );
        assert!(
            validate_github_request("POST", "https://github.com/login/oauth/access_token", "")
                .is_ok()
        );
        assert!(validate_github_request(
            "GET",
            "https://api.github.com/user/repos?affiliation=owner&page=1",
            ""
        )
        .is_ok());
        assert!(validate_github_request(
            "POST",
            "https://api.github.com/repos/octocat/notes/git/blobs",
            "{\"content\":\"hello\",\"encoding\":\"utf-8\"}"
        )
        .is_ok());
        assert!(validate_github_request(
            "PATCH",
            "https://api.github.com/repos/octocat/notes/git/refs/heads/main",
            "{\"sha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"force\":false}"
        )
        .is_ok());
        assert!(validate_github_request("GET", "https://api.github.com/repos/octocat/notes/git/blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "").is_ok());
        assert_eq!(
            validate_github_request(
                "GET",
                "https://raw.githubusercontent.com/octocat/notes/main/README.md",
                ""
            ),
            Err("host_rejected")
        );
        assert_eq!(
            validate_github_request(
                "DELETE",
                "https://api.github.com/repos/octocat/notes/contents/README.md",
                ""
            ),
            Err("host_rejected")
        );
        assert!(validate_github_request(
            "DELETE",
            "https://api.github.com/repos/octocat/notes",
            ""
        )
        .is_ok());
        assert!(validate_github_request("POST", "https://api.github.com/user/repos", "").is_ok());
        assert!(validate_github_request(
            "GET",
            "https://github.com/octocat/notes.git/info/refs?service=git-receive-pack",
            ""
        )
        .is_ok());
        assert!(validate_github_request(
            "POST",
            "https://github.com/octocat/notes.git/git-receive-pack",
            ""
        )
        .is_ok());
        assert_eq!(
            validate_github_request("POST", "https://api.github.com/graphql", ""),
            Err("host_rejected")
        );
        assert_eq!(device_login_target(), "https://github.com/login/device");
        assert!(prepare_transport("GET", "https://api.github.com/user", "", "bearer").is_ok());
        assert_eq!(
            prepare_transport(
                "POST",
                "https://github.com/login/oauth/access_token",
                "",
                "none"
            ),
            Err("oauth_secret_endpoint_refused")
        );
        assert_eq!(
            validate_github_request(
                "PATCH",
                "https://api.github.com/repos/octocat/notes/git/refs/heads/main",
                "{\"force\":true}"
            ),
            Err("force_rejected")
        );
        assert_eq!(
            validate_github_request("GET", "https://github.example.com/api/v3/user", ""),
            Err("host_rejected")
        );
        assert_eq!(
            validate_github_request("GET", "https://api.github.com/orgs/acme/repos", ""),
            Err("host_rejected")
        );
        assert_eq!(
            validate_github_request(
                "GET",
                "https://api.github.com/user?access_token=gho_secret",
                ""
            ),
            Err("token_leak_rejected")
        );
    }

    #[test]
    fn redaction_pagination_and_rate_limit_do_not_echo_secrets() {
        assert_eq!(
            redact_secret("token gho_fixturetokenvalue failed"),
            "token [redacted] failed"
        );
        assert!(!redact_secret("gho_fixturetokenvalue").contains("fixturetokenvalue"));
        assert_eq!(
            next_link("<https://api.github.com/user/repos?page=2>; rel=\"next\""),
            Some("https://api.github.com/user/repos?page=2")
        );
        assert!(rate_limited(429, None, Some("2")));
        assert!(!rate_limited(403, Some("10"), None));
        assert!(credential_account_allowed(ACCESS_ACCOUNT));
        assert!(!credential_account_allowed("providerApiKey_openai"));
        assert!(prepare_transport("GET", "https://api.github.com/user", "", "none").is_ok());
    }

    #[test]
    fn file_content_may_mention_secret_words_without_being_a_transport_field() {
        let body = "{\"content\":\"this source mentions client_secret and \\\"force\\\":true inside text\",\"encoding\":\"utf-8\"}";
        assert!(validate_github_request(
            "POST",
            "https://api.github.com/repos/octocat/notes/git/blobs",
            body
        )
        .is_ok());
        assert_eq!(
            validate_github_request(
                "PATCH",
                "https://api.github.com/repos/octocat/notes/git/refs/heads/main",
                "{\"sha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"force\":true}"
            ),
            Err("force_rejected")
        );
    }

    #[test]
    fn delayed_auth_transitions_do_not_commit_stale_secrets() {
        let mut gate = AuthGate::new();
        let refresh = gate.stamp();
        gate.invalidate().expect("invalidate");
        assert!(!gate.may_write_secret(&refresh));
        let first = gate.begin_flow().expect("flow");
        assert!(gate.note_elevation(&first, "7"));
        gate.invalidate().expect("invalidate");
        let second = gate.begin_flow().expect("flow");
        assert!(!gate.may_write_secret(&first));
        assert!(gate.note_elevation(&second, "7"));
        assert!(gate.bind_pending_account(&second, "7"));
        assert!(gate.may_commit_pending("7", true).is_ok());
        assert_eq!(
            gate.may_commit_pending("8", true),
            Err("delete_scope_elevation_rejected")
        );
        assert!(!cache_nonce_acceptable(11));
        assert!(cache_nonce_acceptable(12));
    }

    struct MemorySecrets {
        values: std::collections::BTreeMap<String, String>,
    }

    impl MemorySecrets {
        fn new() -> Self {
            Self {
                values: std::collections::BTreeMap::new(),
            }
        }

        fn get(&self, account: &str) -> Option<String> {
            self.values.get(account).cloned()
        }
    }

    impl AuthSecretStore for MemorySecrets {
        fn read(&self, account: &str) -> Result<Option<String>, String> {
            Ok(self.get(account))
        }

        fn write(&mut self, account: &str, value: &str) -> Result<(), String> {
            self.values.insert(account.to_string(), value.to_string());
            Ok(())
        }

        fn delete(&mut self, account: &str) -> Result<(), String> {
            self.values.remove(account);
            Ok(())
        }
    }

    fn scopes(values: &[&str]) -> Vec<String> {
        values.iter().map(|item| (*item).to_string()).collect()
    }

    fn authorized_pending(
        account: &str,
        token: &str,
        granted: &[&str],
    ) -> (AuthGate, MemorySecrets, String) {
        let mut gate = AuthGate::new();
        let mut secrets = MemorySecrets::new();
        let stamp = begin_device_flow(&mut gate, &mut secrets).expect("begin");
        bind_device_code(&mut gate, &mut secrets, &stamp, "device-code").expect("device");
        store_polled_pending(&mut gate, &mut secrets, &stamp, token, Some("refresh-code"))
            .expect("pending");
        bind_probed_user(&mut gate, &stamp, account, &scopes(granted)).expect("probe");
        (gate, secrets, stamp.flow_token)
    }

    #[test]
    fn nested_result_wrong_account_is_not_promoted() {
        let (mut gate, mut secrets, flow) =
            authorized_pending("8", "pending-token", &["repo", "delete_repo"]);
        assert!(gate.note_elevation(&gate.stamp(), "7"));
        let rejected = commit_pending_credential(&mut gate, &mut secrets, &flow, "7");
        assert!(
            rejected.is_err(),
            "account rejection must be the function error, not Ok(Err)"
        );
        assert_eq!(rejected.unwrap_err(), "delete_scope_elevation_rejected");
        assert!(secrets.get(ACCESS_ACCOUNT).is_none());
        assert!(secrets.get(PENDING_ACCESS_ACCOUNT).is_none());
    }

    #[test]
    fn same_account_delete_elevation_without_scope_is_rejected_before_promotion() {
        let (mut gate, mut secrets, flow) = authorized_pending("7", "pending-token", &["repo"]);
        assert!(gate.note_elevation(&gate.stamp(), "7"));
        let rejected = commit_pending_credential(&mut gate, &mut secrets, &flow, "7");
        assert_eq!(rejected.unwrap_err(), "delete_scope_elevation_rejected");
        assert!(secrets.get(ACCESS_ACCOUNT).is_none());
    }

    #[test]
    fn flow_a_delayed_probe_cannot_bind_or_promote_flow_b() {
        let mut gate = AuthGate::new();
        let mut secrets = MemorySecrets::new();
        let flow_a = begin_device_flow(&mut gate, &mut secrets).expect("a");
        bind_device_code(&mut gate, &mut secrets, &flow_a, "device-a").expect("device-a");
        store_polled_pending(&mut gate, &mut secrets, &flow_a, "access-a", None)
            .expect("pending-a");
        let (stamp_a, token_a) =
            capture_pending_probe(&gate, &secrets, &flow_a.flow_token).expect("capture-a");
        assert_eq!(token_a, "access-a");
        let flow_b = begin_device_flow(&mut gate, &mut secrets).expect("b");
        bind_device_code(&mut gate, &mut secrets, &flow_b, "device-b").expect("device-b");
        store_polled_pending(&mut gate, &mut secrets, &flow_b, "access-b", None)
            .expect("pending-b");
        assert!(bind_probed_user(&mut gate, &stamp_a, "account-a", &scopes(&["repo"])).is_err());
        assert!(secrets.get(PENDING_ACCESS_ACCOUNT).as_deref() == Some("access-b"));
        let (stamp_b, _) =
            capture_pending_probe(&gate, &secrets, &flow_b.flow_token).expect("capture-b");
        bind_probed_user(&mut gate, &stamp_b, "account-b", &scopes(&["repo"])).expect("probe-b");
        assert!(commit_pending_credential(
            &mut gate,
            &mut secrets,
            &flow_a.flow_token,
            "account-a"
        )
        .is_err());
        assert!(secrets.get(ACCESS_ACCOUNT).is_none());
        assert_eq!(
            secrets.get(PENDING_ACCESS_ACCOUNT).as_deref(),
            Some("access-b")
        );
        commit_pending_credential(&mut gate, &mut secrets, &flow_b.flow_token, "account-b")
            .expect("commit-b");
        assert_eq!(secrets.get(ACCESS_ACCOUNT).as_deref(), Some("access-b"));
    }

    #[test]
    fn begin_while_old_poll_does_not_store_the_old_token() {
        let mut gate = AuthGate::new();
        let mut secrets = MemorySecrets::new();
        let flow_a = begin_device_flow(&mut gate, &mut secrets).expect("a");
        bind_device_code(&mut gate, &mut secrets, &flow_a, "device-a").expect("device-a");
        let (captured, code) =
            capture_device_poll(&gate, &secrets, &flow_a.flow_token).expect("capture");
        assert_eq!(code, "device-a");
        let flow_b = begin_device_flow(&mut gate, &mut secrets).expect("b");
        assert!(secrets.get(DEVICE_ACCOUNT).is_none());
        bind_device_code(&mut gate, &mut secrets, &flow_b, "device-b").expect("device-b");
        assert!(
            store_polled_pending(&mut gate, &mut secrets, &captured, "access-a", None).is_err()
        );
        assert!(secrets.get(PENDING_ACCESS_ACCOUNT).is_none());
        assert_eq!(secrets.get(DEVICE_ACCOUNT).as_deref(), Some("device-b"));
    }

    #[test]
    fn logout_before_commit_does_not_promote_pending_credential() {
        let (mut gate, mut secrets, flow) = authorized_pending("7", "pending-token", &["repo"]);
        let copied = secrets
            .get(PENDING_ACCESS_ACCOUNT)
            .expect("copied outside the lock");
        secrets
            .write(REFRESH_ACCOUNT, "live-refresh")
            .expect("seed refresh");
        let (refresh_stamp, refresh) = capture_refresh(&gate, &secrets).expect("refresh capture");
        assert_eq!(refresh.as_deref(), Some("live-refresh"));
        logout_auth(&mut gate, &mut secrets).expect("logout");
        assert!(commit_pending_credential(&mut gate, &mut secrets, &flow, "7").is_err());
        assert!(store_refreshed(
            &gate,
            &mut secrets,
            &refresh_stamp,
            &copied,
            Some("restored-refresh")
        )
        .is_err());
        assert!(secrets.get(ACCESS_ACCOUNT).is_none());
        assert!(secrets.get(REFRESH_ACCOUNT).is_none());
    }

    #[test]
    fn stale_cancel_and_discard_do_not_delete_newer_pending_credentials() {
        let mut gate = AuthGate::new();
        let mut secrets = MemorySecrets::new();
        let flow_a = begin_device_flow(&mut gate, &mut secrets).expect("a");
        bind_device_code(&mut gate, &mut secrets, &flow_a, "device-a").expect("device-a");
        let flow_b = begin_device_flow(&mut gate, &mut secrets).expect("b");
        bind_device_code(&mut gate, &mut secrets, &flow_b, "device-b").expect("device-b");
        store_polled_pending(
            &mut gate,
            &mut secrets,
            &flow_b,
            "access-b",
            Some("refresh-b"),
        )
        .expect("pending-b");
        cancel_targeted_flow(&mut gate, &mut secrets, &flow_a.flow_token).expect("stale cancel");
        discard_targeted_pending(&mut gate, &mut secrets, &flow_a.flow_token)
            .expect("stale discard");
        assert_eq!(
            secrets.get(PENDING_ACCESS_ACCOUNT).as_deref(),
            Some("access-b")
        );
        assert_eq!(
            secrets.get(PENDING_REFRESH_ACCOUNT).as_deref(),
            Some("refresh-b")
        );
        cancel_targeted_flow(&mut gate, &mut secrets, &flow_b.flow_token).expect("current cancel");
        assert!(secrets.get(PENDING_ACCESS_ACCOUNT).is_none());
        assert!(secrets.get(DEVICE_ACCOUNT).is_none());
    }

    #[test]
    fn recreated_write_authority_accepts_only_its_token_and_does_not_lower_epoch() {
        let mut authority = WriteAuthorityGate::new();
        assert!(!authority.stale(None, Some(0)));
        let first = authority.allocate().expect("service1");
        assert!(authority.note(&first.token, first.epoch + 1).is_ok());
        let switched = authority.current();
        assert!(switched.epoch > first.epoch);
        assert!(authority.note(&first.token, 0).is_err());
        assert_eq!(authority.current().epoch, switched.epoch);
        let second = authority.allocate().expect("service2");
        assert!(second.epoch > switched.epoch);
        assert_ne!(second.token, first.token);
        assert!(authority.stale(Some(&first.token), Some(second.epoch + 5)));
        assert!(!authority.stale(Some(&second.token), Some(second.epoch)));
        let readback = authority.current();
        assert_eq!(authority.current(), readback);
        assert!(authority
            .note(&second.token, second.epoch.saturating_sub(1))
            .is_err());
        assert_eq!(authority.current().epoch, second.epoch);
    }
}
