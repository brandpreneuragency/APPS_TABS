//! Native Google transport shared by the acceptance bootstrap and future Clients adapter.
//! Authentication and bounded read-access diagnostics. No mail sending is exposed.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::blocking::{Client, Response};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use url::Url;

pub const SCOPES: [&str; 2] = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
];
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const PROFILE_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const MESSAGES_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const MAX_JSON: u64 = 64 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailError {
    pub code: &'static str,
    pub retryable: bool,
    pub detail_key: &'static str,
}
fn err(code: &'static str) -> GmailError {
    GmailError {
        code,
        retryable: matches!(code, "OFFLINE" | "RATE_LIMITED"),
        detail_key: code,
    }
}
type Result<T> = std::result::Result<T, GmailError>;

#[derive(Deserialize)]
struct ClientFile {
    installed: ClientConfig,
}
#[derive(Deserialize)]
struct ClientConfig {
    client_id: String,
    client_secret: String,
}
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    token_type: String,
    refresh_token: Option<String>,
    scope: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    email_address: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    id: String,
    email: String,
    client_id_hash: String,
    connected_at: u64,
    scopes: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub config_ready: bool,
    pub account_present: bool,
    pub mailbox: Option<String>,
    pub verified_this_run: bool,
    pub refresh_verified_this_run: bool,
    pub checked_at: Option<u64>,
    pub busy: bool,
    pub sends_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAccessReport {
    schema_version: u8,
    status: &'static str,
    checked_at: u64,
    pid: u32,
    forced_refresh: bool,
    profile_verified: bool,
    list_endpoint_verified: bool,
    message_content_downloaded: bool,
    no_send_performed: bool,
    g1_passed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListAccessResponse {
    result_size_estimate: u32,
}

fn read_access_request(
    client: &Client,
    access: &str,
    connected_at: u64,
) -> reqwest::blocking::RequestBuilder {
    client.get(MESSAGES_URL).bearer_auth(access).query(&[
        ("maxResults", "1".to_string()),
        ("fields", "resultSizeEstimate".to_string()),
        ("q", format!("after:{}", connected_at / 1000)),
    ])
}

pub struct GmailHost {
    root: PathBuf,
    service: String,
    operation: Mutex<()>,
    cancel: AtomicBool,
    verified: Mutex<Option<(u64, bool)>>,
}

impl GmailHost {
    pub fn new(root: PathBuf, identifier: &str) -> Result<Self> {
        if identifier != "com.tabs.clients.acceptance" {
            return Err(err("UNSUPPORTED_RUNTIME"));
        }
        fs::create_dir_all(&root).map_err(|_| err("FILE_UNAVAILABLE"))?;
        Ok(Self {
            root,
            service: format!("{identifier}.gmail"),
            operation: Mutex::new(()),
            cancel: AtomicBool::new(false),
            verified: Mutex::new(None),
        })
    }

    fn file(&self, name: &str) -> Result<PathBuf> {
        let root = self
            .root
            .canonicalize()
            .map_err(|_| err("FILE_UNAVAILABLE"))?;
        let path = root.join(name);
        if path.exists()
            && !path
                .canonicalize()
                .map_err(|_| err("FILE_UNAVAILABLE"))?
                .starts_with(&root)
        {
            return Err(err("FILE_UNAVAILABLE"));
        }
        Ok(path)
    }

    fn config(&self) -> Result<ClientConfig> {
        let data: ClientFile = read_json_file(&self.file("oauth-client.json")?)?;
        if !data
            .installed
            .client_id
            .ends_with(".apps.googleusercontent.com")
            || data.installed.client_id.len() > 512
            || data.installed.client_secret.is_empty()
            || data.installed.client_secret.len() > 512
        {
            return Err(err("VALIDATION"));
        }
        Ok(data.installed)
    }

    fn account(&self) -> Result<Option<Account>> {
        let path = self.file("account.json")?;
        if !path.exists() {
            return Ok(None);
        }
        let account: Account = read_json_file(&path)?;
        if account.id.len() != 43
            || !account
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(err("VALIDATION"));
        }
        validate_scopes(&account.scopes.join(" "))?;
        Ok(Some(account))
    }

    fn credential(&self, id: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(&self.service, id).map_err(|_| err("CREDENTIAL_STORAGE"))
    }

    fn record_check(&self, operation: &str, checked_at: u64) -> Result<()> {
        // Operational evidence only. This is not a full G1/preflight receipt.
        write_json_file(
            &self.file("last-auth-check.json")?,
            &serde_json::json!({
                "schemaVersion": 1, "operation": operation, "status": "passed",
                "checkedAt": checked_at, "pid": std::process::id(),
                "scopesVerified": true, "expectedMailboxVerified": true,
                "forcedRefresh": operation == "refresh", "noSendPerformed": true,
                "g1Passed": false
            }),
        )
    }

    pub fn status(&self) -> Result<AuthStatus> {
        let account = self.account()?;
        let verified = *self.verified.lock().map_err(|_| err("CONFLICT"))?;
        Ok(AuthStatus {
            config_ready: self.config().is_ok(),
            account_present: account.is_some(),
            mailbox: account.map(|a| a.email),
            verified_this_run: verified.is_some(),
            refresh_verified_this_run: verified.is_some_and(|(_, refreshed)| refreshed),
            checked_at: verified.map(|(at, _)| at),
            busy: self.operation.try_lock().is_err(),
            sends_enabled: false,
        })
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    fn not_cancelled(&self) -> Result<()> {
        if self.cancel.load(Ordering::SeqCst) {
            Err(err("AUTH_CANCELLED"))
        } else {
            Ok(())
        }
    }

    pub fn connect(&self, expected_mailbox: String) -> Result<AuthStatus> {
        let operation = self.operation.try_lock().map_err(|_| err("CONFLICT"))?;
        self.cancel.store(false, Ordering::SeqCst);
        *self.verified.lock().map_err(|_| err("CONFLICT"))? = None;
        let expected = normalize_mailbox(&expected_mailbox)?;
        let previous = self.account()?;
        if previous.as_ref().is_some_and(|a| a.email != expected) {
            return Err(err("ACCOUNT_MISMATCH"));
        }
        let config = self.config()?;
        let client = http_client()?;
        let state = random_string()?;
        let verifier = random_string()?;
        let listener =
            TcpListener::bind(("127.0.0.1", 0)).map_err(|_| err("CALLBACK_UNAVAILABLE"))?;
        listener
            .set_nonblocking(true)
            .map_err(|_| err("CALLBACK_UNAVAILABLE"))?;
        let authority = listener
            .local_addr()
            .map_err(|_| err("CALLBACK_UNAVAILABLE"))?
            .to_string();
        let redirect = format!("http://{authority}/oauth/callback");
        let mut auth = Url::parse(AUTH_URL).map_err(|_| err("VALIDATION"))?;
        auth.query_pairs_mut().extend_pairs([
            ("client_id", config.client_id.as_str()),
            ("redirect_uri", &redirect),
            ("response_type", "code"),
            ("scope", &SCOPES.join(" ")),
            ("state", &state),
            ("code_challenge", &pkce_challenge(&verifier)),
            ("code_challenge_method", "S256"),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("login_hint", &expected),
        ]);
        open_google_browser(&auth)?;
        let code = self.receive_code(&listener, &authority, &state)?;
        drop(listener);
        self.not_cancelled()?;
        let token: TokenResponse = read_response(
            client
                .post(TOKEN_URL)
                .form(&[
                    ("client_id", config.client_id.as_str()),
                    ("client_secret", &config.client_secret),
                    ("code", &code),
                    ("code_verifier", &verifier),
                    ("redirect_uri", &redirect),
                    ("grant_type", "authorization_code"),
                ])
                .send()
                .map_err(|_| err("OFFLINE"))?,
        )?;
        validate_token(&token, true)?;
        let profile = get_profile(&client, &token.access_token)?;
        if normalize_mailbox(&profile.email_address)? != expected {
            return Err(err("ACCOUNT_MISMATCH"));
        }
        self.not_cancelled()?;
        let account = Account {
            id: match &previous {
                Some(a) => a.id.clone(),
                None => random_string()?,
            },
            email: expected,
            client_id_hash: hash_text(&config.client_id),
            connected_at: previous.as_ref().map_or(now_ms(), |a| a.connected_at),
            scopes: SCOPES.iter().map(|s| (*s).to_string()).collect(),
        };
        let refresh = token
            .refresh_token
            .filter(|s| !s.is_empty())
            .ok_or_else(|| err("AUTH_REQUIRED"))?;
        let credential = self.credential(&account.id)?;
        credential
            .set_password(&refresh)
            .map_err(|_| err("CREDENTIAL_STORAGE"))?;
        if let Err(error) = write_json_file(&self.file("account.json")?, &account) {
            if previous.is_none() {
                let _ = credential.delete_credential();
            }
            return Err(error);
        }
        let checked_at = now_ms();
        self.record_check("connect", checked_at)?;
        *self.verified.lock().map_err(|_| err("CONFLICT"))? = Some((checked_at, false));
        drop(operation);
        self.status()
    }

    fn receive_code(&self, listener: &TcpListener, authority: &str, state: &str) -> Result<String> {
        let deadline = Instant::now() + Duration::from_secs(180);
        while Instant::now() < deadline {
            self.not_cancelled()?;
            match listener.accept() {
                Ok((mut stream, peer)) => {
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    let request = read_request(&mut stream, deadline, &self.cancel);
                    let parsed = request.and_then(|r| parse_callback(&r, authority, state));
                    let (status, body) = if parsed.is_ok() {
                        ("200 OK", "Authorization received. Return to TABS Clients Acceptance. / TABS test uygulamasina donebilirsiniz.")
                    } else {
                        (
                            "400 Bad Request",
                            "Authorization was not accepted. Return to TABS Clients Acceptance.",
                        )
                    };
                    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));
                    let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}", body.len());
                    match parsed {
                        Ok(code) => return Ok(code),
                        Err(error) if error.code == "AUTH_CANCELLED" => return Err(error),
                        _ => continue,
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                Err(_) => return Err(err("CALLBACK_UNAVAILABLE")),
            }
        }
        Err(err("AUTH_TIMEOUT"))
    }

    /// Always exchanges the stored refresh token; never reuses an access token.
    pub fn refresh(&self) -> Result<AuthStatus> {
        let operation = self.operation.try_lock().map_err(|_| err("CONFLICT"))?;
        self.cancel.store(false, Ordering::SeqCst);
        *self.verified.lock().map_err(|_| err("CONFLICT"))? = None;
        self.refresh_session()?;
        drop(operation);
        self.status()
    }

    // Caller holds operation for the entire refresh + dependent request.
    fn refresh_session(&self) -> Result<(Client, String, Account)> {
        let account = self.account()?.ok_or_else(|| err("AUTH_REQUIRED"))?;
        let config = self.config()?;
        if account.client_id_hash != hash_text(&config.client_id) {
            return Err(err("AUTH_REQUIRED"));
        }
        let credential = self.credential(&account.id)?;
        let refresh = credential
            .get_password()
            .map_err(|_| err("AUTH_REQUIRED"))?;
        let client = http_client()?;
        let token: TokenResponse = read_response(
            client
                .post(TOKEN_URL)
                .form(&[
                    ("client_id", config.client_id.as_str()),
                    ("client_secret", &config.client_secret),
                    ("refresh_token", &refresh),
                    ("grant_type", "refresh_token"),
                ])
                .send()
                .map_err(|_| err("OFFLINE"))?,
        )?;
        validate_token(&token, false)?;
        let profile = get_profile(&client, &token.access_token)?;
        if normalize_mailbox(&profile.email_address)? != account.email {
            return Err(err("ACCOUNT_MISMATCH"));
        }
        self.not_cancelled()?;
        if let Some(rotated) = token.refresh_token.filter(|s| !s.is_empty()) {
            credential
                .set_password(&rotated)
                .map_err(|_| err("CREDENTIAL_STORAGE"))?;
        }
        let checked_at = now_ms();
        self.record_check("refresh", checked_at)?;
        *self.verified.lock().map_err(|_| err("CONFLICT"))? = Some((checked_at, true));
        Ok((client, token.access_token, account))
    }

    /// Only asks for the result count; no message IDs, headers, bodies or attachments.
    /// This is an access smoke check, not PF-READ or full live Gmail acceptance.
    pub fn check_read_access(&self) -> Result<ReadAccessReport> {
        let _operation = self.operation.try_lock().map_err(|_| err("CONFLICT"))?;
        self.cancel.store(false, Ordering::SeqCst);
        *self.verified.lock().map_err(|_| err("CONFLICT"))? = None;
        let (client, access, account) = self.refresh_session()?;
        self.not_cancelled()?;
        let response: ListAccessResponse = read_response(
            read_access_request(&client, &access, account.connected_at)
                .send()
                .map_err(|_| err("OFFLINE"))?,
        )?;
        // Zero results are valid. Neither the count nor any mailbox data is persisted.
        let _ = response.result_size_estimate;
        self.not_cancelled()?;
        let report = ReadAccessReport {
            schema_version: 1,
            status: "passed",
            checked_at: now_ms(),
            pid: std::process::id(),
            forced_refresh: true,
            profile_verified: true,
            list_endpoint_verified: true,
            message_content_downloaded: false,
            no_send_performed: true,
            g1_passed: false,
        };
        write_json_file(&self.file("last-read-access-check.json")?, &report)?;
        Ok(report)
    }

    pub fn disconnect(&self) -> Result<AuthStatus> {
        let operation = self.operation.try_lock().map_err(|_| err("CONFLICT"))?;
        if let Some(account) = self.account()? {
            match self.credential(&account.id)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => (),
                Err(_) => return Err(err("CREDENTIAL_STORAGE")),
            }
            fs::remove_file(self.file("account.json")?).map_err(|_| err("FILE_UNAVAILABLE"))?;
        }
        *self.verified.lock().map_err(|_| err("CONFLICT"))? = None;
        drop(operation);
        self.status()
    }
}

fn http_client() -> Result<Client> {
    Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| err("OFFLINE"))
}
fn read_response<T: DeserializeOwned>(response: Response) -> Result<T> {
    if !response.status().is_success() {
        return Err(err(match response.status().as_u16() {
            400 | 401 => "AUTH_REQUIRED",
            403 => "ACCESS_BLOCKED",
            429 => "RATE_LIMITED",
            _ => "OFFLINE",
        }));
    }
    read_json(response)
}
fn read_json<T: DeserializeOwned>(reader: impl Read) -> Result<T> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_JSON + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| err("FILE_UNAVAILABLE"))?;
    if bytes.len() as u64 > MAX_JSON {
        return Err(err("VALIDATION"));
    }
    serde_json::from_slice(&bytes).map_err(|_| err("VALIDATION"))
}
fn read_json_file<T: DeserializeOwned>(path: &Path) -> Result<T> {
    read_json(fs::File::open(path).map_err(|_| err("FILE_UNAVAILABLE"))?)
}
pub fn write_json_file<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path.parent().ok_or_else(|| err("FILE_UNAVAILABLE"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| err("FILE_UNAVAILABLE"))?;
    serde_json::to_writer(temp.as_file_mut(), value).map_err(|_| err("FILE_UNAVAILABLE"))?;
    temp.as_file()
        .sync_all()
        .map_err(|_| err("FILE_UNAVAILABLE"))?;
    temp.persist(path).map_err(|_| err("FILE_UNAVAILABLE"))?;
    Ok(())
}
fn get_profile(client: &Client, access: &str) -> Result<Profile> {
    read_response(
        client
            .get(PROFILE_URL)
            .bearer_auth(access)
            .send()
            .map_err(|_| err("OFFLINE"))?,
    )
}
fn validate_token(token: &TokenResponse, require_scopes: bool) -> Result<()> {
    if !token.token_type.eq_ignore_ascii_case("bearer") || token.access_token.is_empty() {
        return Err(err("AUTH_REQUIRED"));
    }
    match &token.scope {
        Some(scopes) => validate_scopes(scopes),
        None if require_scopes => Err(err("SCOPE_MISSING")),
        None => Ok(()), // Refresh inherits the previously verified grant if scope is omitted.
    }
}
fn validate_scopes(scopes: &str) -> Result<()> {
    let granted: std::collections::HashSet<_> = scopes.split_whitespace().collect();
    if granted.len() != SCOPES.len() || SCOPES.iter().any(|s| !granted.contains(s)) {
        return Err(err("SCOPE_MISSING"));
    }
    Ok(())
}
fn normalize_mailbox(value: &str) -> Result<String> {
    let value = value.trim().to_ascii_lowercase();
    let parts: Vec<_> = value.split('@').collect();
    if value.len() > 254
        || parts.len() != 2
        || parts.iter().any(|p| p.is_empty())
        || value.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(err("VALIDATION"));
    }
    Ok(value)
}
fn random_string() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| err("RANDOM_UNAVAILABLE"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn hash_text(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn read_request(stream: &mut TcpStream, deadline: Instant, cancel: &AtomicBool) -> Result<String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|_| err("CALLBACK_UNAVAILABLE"))?;
    let deadline = deadline.min(Instant::now() + Duration::from_secs(2));
    let mut bytes = Vec::new();
    while bytes.len() < 8192 && Instant::now() < deadline && !cancel.load(Ordering::SeqCst) {
        let mut chunk = [0; 512];
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(size) => {
                bytes.extend_from_slice(&chunk[..size]);
                if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                continue
            }
            Err(_) => return Err(err("VALIDATION")),
        }
    }
    if bytes.len() > 8192 || !bytes.ends_with(b"\r\n\r\n") {
        return Err(err("VALIDATION"));
    }
    String::from_utf8(bytes).map_err(|_| err("VALIDATION"))
}
fn parse_callback(request: &str, authority: &str, state: &str) -> Result<String> {
    let mut lines = request.split("\r\n");
    let first: Vec<_> = lines
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .collect();
    if first.len() != 3
        || first[0] != "GET"
        || first[2] != "HTTP/1.1"
        || !first[1].starts_with("/oauth/callback?")
    {
        return Err(err("VALIDATION"));
    }
    let hosts: Vec<_> = lines
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.eq_ignore_ascii_case("host"))
        .map(|(_, value)| value.trim())
        .collect();
    if hosts != [authority] {
        return Err(err("VALIDATION"));
    }
    let url =
        Url::parse(&format!("http://{authority}{}", first[1])).map_err(|_| err("VALIDATION"))?;
    if url.fragment().is_some() {
        return Err(err("VALIDATION"));
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    let states: Vec<_> = pairs
        .iter()
        .filter(|(k, _)| k == "state")
        .map(|(_, v)| v.as_ref())
        .collect();
    if states != [state] {
        return Err(err("VALIDATION"));
    }
    if pairs.iter().any(|(k, _)| k == "error") {
        return Err(err("AUTH_CANCELLED"));
    }
    let codes: Vec<_> = pairs
        .iter()
        .filter(|(k, _)| k == "code")
        .map(|(_, v)| v.as_ref())
        .collect();
    if codes.len() != 1 || codes[0].is_empty() {
        return Err(err("VALIDATION"));
    }
    Ok(codes[0].to_string())
}

#[cfg(windows)]
fn open_google_browser(url: &Url) -> Result<()> {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    if url.scheme() != "https"
        || url.host_str() != Some("accounts.google.com")
        || url.path() != "/o/oauth2/v2/auth"
    {
        return Err(err("VALIDATION"));
    }
    let operation: Vec<u16> = "open\0".encode_utf16().collect();
    let target: Vec<u16> = url.as_str().encode_utf16().chain(Some(0)).collect();
    // The URL is passed directly to the Windows API, never through a shell command.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        Err(err("BROWSER_UNAVAILABLE"))
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn open_google_browser(_: &Url) -> Result<()> {
    Err(err("UNSUPPORTED_RUNTIME"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn read_access_is_bounded_and_requests_no_message_data() {
        let request = read_access_request(&http_client().unwrap(), "synthetic", 1234567)
            .build()
            .unwrap();
        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(request.url().host_str(), Some("gmail.googleapis.com"));
        let query: std::collections::HashMap<_, _> = request.url().query_pairs().collect();
        assert_eq!(query.get("fields").unwrap(), "resultSizeEstimate");
        assert_eq!(query.get("maxResults").unwrap(), "1");
        assert_eq!(query.get("q").unwrap(), "after:1234");
        assert!(request.body().is_none());
        assert!(serde_json::from_str::<ListAccessResponse>(r#"{"resultSizeEstimate":0}"#).is_ok());
        assert!(serde_json::from_str::<ListAccessResponse>(r#"{"messages":[]}"#).is_err());
    }
    #[test]
    fn rfc7636_pkce_vector() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn rejects_missing_and_excessive_scopes() {
        assert!(validate_scopes(&SCOPES.join(" ")).is_ok());
        assert!(validate_scopes(SCOPES[0]).is_err());
        assert!(
            validate_scopes(&format!("{} https://mail.google.com/", SCOPES.join(" "))).is_err()
        );
    }
    #[test]
    fn callback_binds_host_state_path_and_single_code() {
        let valid = "GET /oauth/callback?state=nonce&code=synthetic HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n\r\n";
        assert_eq!(
            parse_callback(valid, "127.0.0.1:1234", "nonce").unwrap(),
            "synthetic"
        );
        assert!(parse_callback(valid, "127.0.0.1:4567", "nonce").is_err());
        assert!(parse_callback(valid, "127.0.0.1:1234", "other").is_err());
        for changed in [
            valid.replace("&code=", "&state=other&code="),
            valid.replace("&code=", "&code=other&code="),
            valid.replace("/oauth/callback", "/other"),
            valid.replace("GET", "POST"),
        ] {
            assert!(parse_callback(&changed, "127.0.0.1:1234", "nonce").is_err());
        }
    }
    #[test]
    fn cancellation_requires_matching_state() {
        let denied = "GET /oauth/callback?state=nonce&error=access_denied HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n\r\n";
        assert_eq!(
            parse_callback(denied, "127.0.0.1:1234", "nonce")
                .unwrap_err()
                .code,
            "AUTH_CANCELLED"
        );
        assert_eq!(
            parse_callback(denied, "127.0.0.1:1234", "other")
                .unwrap_err()
                .code,
            "VALIDATION"
        );
    }
    #[test]
    fn refresh_may_inherit_scopes_but_initial_consent_may_not() {
        let token = TokenResponse {
            access_token: "synthetic".into(),
            token_type: "Bearer".into(),
            refresh_token: None,
            scope: None,
        };
        assert!(validate_token(&token, false).is_ok());
        assert!(validate_token(&token, true).is_err());
    }
    #[test]
    fn rejects_oversized_provider_or_config_json() {
        let bytes = vec![b' '; MAX_JSON as usize + 1];
        assert!(read_json::<serde_json::Value>(&bytes[..]).is_err());
    }
    #[test]
    fn metadata_write_is_replaceable_and_contains_no_tokens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("account.json");
        let mut account = Account {
            id: random_string().unwrap(),
            email: "fixture@example.invalid".into(),
            client_id_hash: "hash".into(),
            connected_at: 1,
            scopes: SCOPES.iter().map(|s| s.to_string()).collect(),
        };
        write_json_file(&path, &account).unwrap();
        account.connected_at = 2;
        write_json_file(&path, &account).unwrap();
        let restored: Account = read_json_file(&path).unwrap();
        assert_eq!(restored.connected_at, 2);
        assert!(!fs::read_to_string(path).unwrap().contains("token"));
    }
    #[test]
    fn production_namespace_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        assert!(GmailHost::new(dir.path().to_path_buf(), "com.tabs.app").is_err());
    }
}
