use super::model::{initial_accounts, slot_index, ProviderAccount};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const STORAGE_ERROR: &str =
    "Provider account snapshots could not be read; existing data was preserved";

#[cfg(test)]
pub fn test_temp_root() -> PathBuf {
    std::env::var_os("TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

pub fn reject_link(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err("Provider account path must not be a reparse point".into());
                }
            }
            if meta.file_type().is_symlink() {
                return Err("Provider account path must not be a symlink".into());
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Could not inspect provider account path".into()),
    }
}

pub fn directory(parent: &Path, name: &str) -> Result<PathBuf, String> {
    reject_link(parent)?;
    let path = parent.join(name);
    reject_link(&path)?;
    std::fs::create_dir_all(&path).map_err(|_| "Could not create provider account directory")?;
    reject_link(&path)?;
    path.canonicalize()
        .map_err(|_| "Could not resolve provider account directory".into())
}

fn validate(accounts: &[ProviderAccount]) -> Result<(), String> {
    let expected = initial_accounts();
    if accounts.len() != expected.len() {
        return Err(STORAGE_ERROR.into());
    }
    for (index, a) in accounts.iter().enumerate() {
        if slot_index(&a.id)? != index || a.provider_id != "openai-codex" || a.label.len() > 256 {
            return Err(STORAGE_ERROR.into());
        }
        if let Some(id) = &a.duplicate_of {
            slot_index(id)?;
        }
    }
    Ok(())
}

pub fn load(root: &Path) -> Result<Vec<ProviderAccount>, String> {
    reject_link(root)?;
    let path = root.join("accounts.json");
    reject_link(&path)?;
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(initial_accounts()),
        Err(_) => return Err(STORAGE_ERROR.into()),
    };
    let mut bytes = Vec::new();
    file.take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| STORAGE_ERROR)?;
    if bytes.len() > 1024 * 1024 {
        return Err(STORAGE_ERROR.into());
    }
    let accounts: Vec<ProviderAccount> =
        serde_json::from_slice(&bytes).map_err(|_| STORAGE_ERROR)?;
    validate(&accounts)?;
    Ok(accounts)
}

/// Caller serializes the entire read/modify/write under the store's metadata lock.
/// Never repair, truncate, rename away or overwrite a corrupt existing snapshot.
pub fn save(root: &Path, accounts: &[ProviderAccount]) -> Result<(), String> {
    let _ = load(root)?;
    validate(accounts)?;
    let mut file =
        tempfile::NamedTempFile::new_in(root).map_err(|_| "Could not stage account snapshots")?;
    let bytes =
        serde_json::to_vec_pretty(accounts).map_err(|_| "Could not encode account snapshots")?;
    file.write_all(&bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| "Could not persist account snapshots")?;
    reject_link(&root.join("accounts.json"))?;
    file.persist(root.join("accounts.json"))
        .map_err(|_| "Could not atomically replace account snapshots")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_round_trip_and_never_erase_corruption() {
        let dir = tempfile::Builder::new()
            .prefix("tabs-provider-test-")
            .tempdir_in(test_temp_root())
            .unwrap();
        let mut a = initial_accounts();
        a[0].label = "My account".into();
        save(dir.path(), &a).unwrap();
        assert_eq!(load(dir.path()).unwrap(), a);
        let target = dir.path().join("accounts.json");
        std::fs::write(&target, b"broken-owner-data").unwrap();
        assert!(load(dir.path()).is_err());
        assert!(save(dir.path(), &a).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"broken-owner-data");
    }
    #[test]
    fn persisted_unknown_fields_and_unknown_slots_are_rejected() {
        let dir = tempfile::Builder::new()
            .prefix("tabs-provider-test-")
            .tempdir_in(test_temp_root())
            .unwrap();
        let mut value = serde_json::to_value(initial_accounts()).unwrap();
        value[0]["accessToken"] = "test-only-not-a-token".into();
        std::fs::write(
            dir.path().join("accounts.json"),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
        assert!(load(dir.path()).is_err());
        let mut a = initial_accounts();
        a[0].id = "../escape".into();
        std::fs::write(
            dir.path().join("accounts.json"),
            serde_json::to_vec(&a).unwrap(),
        )
        .unwrap();
        assert!(load(dir.path()).is_err());
    }
}
