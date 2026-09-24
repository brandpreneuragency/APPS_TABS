// Narrow one-time cleanup of TABS-owned legacy AI credentials. The configured
// app identifier is the keyring service; acceptance builds have a separate ID.
use keyring::Entry;

fn secret_get_for_service(service: &str, account: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(service, account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn secret_delete_for_service(service: &str, account: &str) -> Result<(), String> {
    let entry = Entry::new(service, account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn legacy_ai_preference(app: tauri::AppHandle) -> Result<Option<String>, String> {
    secret_get_for_service(&app.config().identifier, "activeAgentId")
}

fn is_legacy_ai_account(account: &str) -> bool {
    if matches!(
        account,
        "activeAgentId" | "activeProviderId" | "appManagementProviderId" | "hiddenModels"
    ) {
        return true;
    }
    account.strip_prefix("providerApiKey_").is_some_and(|id| {
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    })
}

#[tauri::command]
pub fn legacy_ai_cleanup(app: tauri::AppHandle, accounts: Vec<String>) -> Result<(), String> {
    if accounts.len() > 256
        || accounts
            .iter()
            .any(|account| !is_legacy_ai_account(account))
    {
        return Err("Invalid legacy AI cleanup manifest".into());
    }
    for account in accounts {
        secret_delete_for_service(&app.config().identifier, &account)
            .map_err(|_| "Legacy AI credential cleanup is incomplete".to_string())?;
        if secret_get_for_service(&app.config().identifier, &account)
            .map_err(|_| "Legacy AI credential cleanup could not be verified".to_string())?
            .is_some()
        {
            return Err("Legacy AI credential cleanup could not be verified".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_legacy_ai_account, secret_delete_for_service, secret_get_for_service};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn cleanup_is_scoped_to_tabs_accounts() {
        assert!(is_legacy_ai_account("providerApiKey_openai"));
        assert!(is_legacy_ai_account("activeAgentId"));
        assert!(!is_legacy_ai_account("codex-auth"));
        assert!(!is_legacy_ai_account("providerApiKey_../other"));
    }

    #[test]
    fn legacy_cleanup_is_idempotent_in_synthetic_service() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let account = format!("tabs-keyring-test-{}-{nonce}", std::process::id());
        let service = format!("com.tabs.app.synthetic-test-{}-{nonce}", std::process::id());
        // No real credential or production keyring namespace is touched.
        assert_eq!(secret_get_for_service(&service, &account).unwrap(), None);
        secret_delete_for_service(&service, &account).expect("secret should be deleted");
        secret_delete_for_service(&service, &account).expect("retry should succeed");
        assert_eq!(
            secret_get_for_service(&service, &account)
                .expect("deleted secret lookup should succeed"),
            None,
        );
    }
}
