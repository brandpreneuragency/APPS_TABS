use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub key: String,
    pub email: Option<String>,
    pub workspace_id: Option<String>,
    pub plan: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageWindow {
    pub id: String,
    pub window_minutes: i64,
    pub used_percent: Option<f64>,
    pub resets_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Usage {
    pub windows: Vec<UsageWindow>,
    pub reset_tokens: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccountStatus {
    Disconnected,
    Connected,
    AuthRequired,
    Error,
    Duplicate,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderAccount {
    pub id: String,
    pub provider_id: String,
    pub label: String,
    pub identity: Option<Identity>,
    pub status: AccountStatus,
    pub duplicate_of: Option<String>,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub error: Option<String>,
    pub usage: Option<Usage>,
}

pub fn initial_accounts() -> Vec<ProviderAccount> {
    (1..=4)
        .map(|n| ProviderAccount {
            id: format!("codex-{n}"),
            provider_id: "openai-codex".into(),
            label: format!("Codex {n}"),
            identity: None,
            status: AccountStatus::Disconnected,
            duplicate_of: None,
            last_attempt_at: None,
            last_success_at: None,
            error: None,
            usage: None,
        })
        .collect()
}

pub fn slot_index(id: &str) -> Result<usize, String> {
    initial_accounts()
        .iter()
        .position(|a| a.id == id)
        .ok_or_else(|| "Unknown provider account slot".into())
}

pub fn parse_usage(value: &Value) -> Result<Usage, String> {
    let bucket = value
        .get("rateLimitsByLimitId")
        .and_then(|b| b.get("codex"))
        .or_else(|| value.get("rateLimits"))
        .filter(|v| v.is_object())
        .ok_or("Codex returned an invalid rate-limit snapshot")?;
    let mut windows = Vec::new();
    for name in ["primary", "secondary"] {
        let Some(w) = bucket.get(name).filter(|w| w.is_object()) else {
            continue;
        };
        let Some(minutes) = w
            .get("windowDurationMins")
            .and_then(Value::as_i64)
            .filter(|m| *m > 0)
        else {
            continue;
        };
        let id = match minutes {
            300 => "fiveHour".into(),
            10080 => "weekly".into(),
            m => format!("minutes-{m}"),
        };
        if windows.iter().any(|w: &UsageWindow| w.id == id) {
            continue;
        }
        windows.push(UsageWindow {
            id,
            window_minutes: minutes,
            used_percent: w
                .get("usedPercent")
                .and_then(Value::as_f64)
                .filter(|n| n.is_finite() && *n >= 0.0),
            resets_at: w
                .get("resetsAt")
                .and_then(Value::as_i64)
                .filter(|n| *n >= 0)
                .and_then(|n| n.checked_mul(1000)),
        });
    }
    windows.sort_by_key(|w| w.window_minutes);
    Ok(Usage {
        windows,
        reset_tokens: value
            .pointer("/rateLimitResetCredits/availableCount")
            .and_then(Value::as_i64)
            .filter(|n| *n >= 0),
    })
}

/// Only non-secret claims extracted from the exact slot's Codex-owned keyring entry.
/// This is local ownership metadata, NOT JWT signature validation or remote authorization.
pub fn identity_from_claims(account: &Value, auth: &Value) -> Option<Identity> {
    let info = account.get("account")?;
    if info.get("type")?.as_str()? != "chatgpt" {
        return None;
    }
    let claims = auth.get("https://api.openai.com/auth")?;
    let principal = claims
        .get("chatgpt_user_id")
        .or_else(|| claims.get("user_id"))
        .and_then(Value::as_str)
        .filter(|s| valid_id(s))?;
    let workspace = account
        .pointer("/workspaceRouting/chatgptAccountId")
        .and_then(Value::as_str)
        .or_else(|| claims.get("chatgpt_account_id").and_then(Value::as_str))
        .filter(|s| valid_id(s))?;
    if claims
        .get("chatgpt_account_id")
        .and_then(Value::as_str)
        .is_some_and(|s| s != workspace)
    {
        return None;
    }
    let key = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&("openai-codex", principal, workspace)).ok()?)
    );
    Some(Identity {
        key,
        email: info.get("email").and_then(Value::as_str).map(str::to_owned),
        workspace_id: Some(workspace.into()),
        plan: info
            .get("planType")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 1024 && s.trim() == s && !s.chars().any(char::is_control)
}

pub fn apply_identity(account: &mut ProviderAccount, identity: Option<Identity>) {
    let same = account
        .identity
        .as_ref()
        .zip(identity.as_ref())
        .is_some_and(|(a, b)| a.key == b.key);
    if !same {
        account.usage = None;
        account.last_success_at = None;
    }
    account.identity = identity;
    account.duplicate_of = None;
}

pub fn mark_error(account: &mut ProviderAccount, now: i64, message: &str) {
    account.last_attempt_at = Some(now);
    account.status = AccountStatus::Error;
    account.error = Some(message.into());
}

pub fn mark_duplicates(accounts: &mut [ProviderAccount]) {
    let mut seen: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for a in accounts {
        a.duplicate_of = None;
        if a.status == AccountStatus::Duplicate {
            a.status = AccountStatus::Connected;
        }
        if let Some(identity) = &a.identity {
            if let Some(id) = seen.get(&identity.key) {
                a.duplicate_of = Some(id.clone());
                // Preserve errors/auth-required rather than masking a failed observation.
                if a.status == AccountStatus::Connected {
                    a.status = AccountStatus::Duplicate;
                }
            } else {
                seen.insert(identity.key.clone(), a.id.clone());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn windows_follow_duration_and_authoritative_reset_count() {
        let u = parse_usage(&json!({"rateLimits":{"primary":{"windowDurationMins":10080,"usedPercent":9,"resetsAt":42},"secondary":{"windowDurationMins":300,"usedPercent":101}},"rateLimitResetCredits":{"availableCount":7,"credits":[]}})).unwrap();
        assert_eq!(u.windows[0].id, "fiveHour");
        assert_eq!(u.windows[1].resets_at, Some(42000));
        assert_eq!(u.reset_tokens, Some(7));
    }
    #[test]
    fn missing_is_unknown_not_zero() {
        let u = parse_usage(&json!({"rateLimits":{"primary":{"usedPercent":0}}})).unwrap();
        assert!(u.windows.is_empty());
        assert_eq!(u.reset_tokens, None);
    }
    #[test]
    fn slot_paths_are_exact_allowlist() {
        for id in [
            "../codex-1",
            "codex-01",
            "codex-5",
            "codex-1/../codex-2",
            "C:\\x",
        ] {
            assert!(slot_index(id).is_err());
        }
        assert_eq!(slot_index("codex-4").unwrap(), 3);
    }
    #[test]
    fn email_is_not_identity_and_workspace_is_part_of_key() {
        let account =
            json!({"account":{"type":"chatgpt","email":"same@example.test","planType":"plus"}});
        assert!(identity_from_claims(&account, &json!({})).is_none());
        let claims = |p, w| json!({"https://api.openai.com/auth":{"chatgpt_user_id":p,"chatgpt_account_id":w}});
        let a = identity_from_claims(&account, &claims("user-a", "workspace-a")).unwrap();
        assert_ne!(
            a.key,
            identity_from_claims(&account, &claims("user-b", "workspace-a"))
                .unwrap()
                .key
        );
        assert_ne!(
            a.key,
            identity_from_claims(&account, &claims("user-a", "workspace-b"))
                .unwrap()
                .key
        );
        let routed =
            json!({"account":{"type":"chatgpt"},"workspaceRouting":{"chatgptAccountId":"other"}});
        assert!(identity_from_claims(&routed, &claims("user-a", "workspace-a")).is_none());
    }
    #[test]
    fn error_preserves_usage_but_replacement_never_does() {
        let mut a = initial_accounts().remove(0);
        a.identity = Some(Identity {
            key: "a".into(),
            email: None,
            workspace_id: None,
            plan: None,
        });
        a.usage = Some(Usage {
            windows: vec![],
            reset_tokens: Some(7),
        });
        a.last_success_at = Some(10);
        mark_error(&mut a, 20, "Unavailable");
        assert_eq!(a.usage.as_ref().unwrap().reset_tokens, Some(7));
        assert_eq!(a.last_success_at, Some(10));
        apply_identity(&mut a, None);
        assert!(a.usage.is_none());
        assert!(a.last_success_at.is_none());
    }
    #[test]
    fn duplicates_use_composite_identity_not_email() {
        let mut a = initial_accounts();
        let id = Identity {
            key: "same-principal-and-workspace".into(),
            email: None,
            workspace_id: None,
            plan: None,
        };
        a[0].identity = Some(id.clone());
        a[1].identity = Some(id);
        a[0].status = AccountStatus::Connected;
        a[1].status = AccountStatus::Connected;
        mark_duplicates(&mut a);
        assert_eq!(a[1].duplicate_of.as_deref(), Some("codex-1"));
        assert_eq!(a[1].status, AccountStatus::Duplicate);
    }
}
