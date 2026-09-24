use std::ffi::OsString;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct Launch {
    pub executable: PathBuf,
    pub arguments: Vec<OsString>,
    pub display_path: PathBuf,
}

/// Rust canonicalization uses Windows verbatim paths. Node's CLI entry point
/// resolver rejects that spelling, so use the equivalent ordinary path only
/// after the target has been resolved and checked as a regular file.
pub(crate) fn cli_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(value) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{value}");
        }
        if let Some(value) = value.strip_prefix(r"\\?\") {
            return value.to_owned();
        }
    }
    value.into_owned()
}

fn existing_file(path: PathBuf) -> Option<PathBuf> {
    path.canonicalize()
        .ok()
        .filter(|resolved| resolved.is_file())
}

fn find_on_path(names: &[&str]) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&paths) {
        for name in names {
            if let Some(path) = existing_file(directory.join(name)) {
                return Some(path);
            }
        }
    }
    None
}

fn npm_directory() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|app_data| PathBuf::from(app_data).join("npm"))
}

fn npm_shim(names: &[&str]) -> Option<PathBuf> {
    find_on_path(names).or_else(|| {
        let directory = npm_directory()?;
        names
            .iter()
            .find_map(|name| existing_file(directory.join(name)))
    })
}

fn node_for_shim(shim: &Path) -> Option<PathBuf> {
    shim.parent()
        .and_then(|directory| existing_file(directory.join("node.exe")))
        .or_else(|| find_on_path(&["node.exe"]))
}

pub fn discover(provider_id: &str) -> Result<Launch, &'static str> {
    match provider_id {
        "grok" => {
            let path = find_on_path(&["grok.exe"]).or_else(|| {
                std::env::var_os("USERPROFILE").and_then(|profile| {
                    existing_file(
                        PathBuf::from(profile)
                            .join(".grok")
                            .join("bin")
                            .join("grok.exe"),
                    )
                })
            });
            let path = path.ok_or("Grok Build CLI was not found. Install it and reopen TABS.")?;
            Ok(Launch {
                executable: path.clone(),
                arguments: Vec::new(),
                display_path: PathBuf::from(cli_path(&path)),
            })
        }
        "commandCode" => {
            let shim = npm_shim(&["cmdc.cmd", "command-code.cmd", "commandcode.cmd"])
                .ok_or("Command Code CLI was not found. Install it and reopen TABS.")?;
            let entry = shim
                .parent()
                .and_then(|directory| {
                    existing_file(
                        directory
                            .join("node_modules")
                            .join("command-code")
                            .join("dist")
                            .join("index.mjs"),
                    )
                })
                .ok_or("Command Code's npm package is incomplete. Reinstall the CLI.")?;
            let node = node_for_shim(&shim)
                .ok_or("Node.js is required to run the installed Command Code CLI.")?;
            Ok(Launch {
                executable: node,
                arguments: vec![OsString::from(cli_path(&entry))],
                display_path: PathBuf::from(cli_path(&entry)),
            })
        }
        "openCode" => {
            let native = find_on_path(&["opencode.exe"]);
            let native = native.or_else(|| {
                let shim = npm_shim(&["opencode.cmd"])?;
                let directory = shim.parent()?;
                existing_file(
                    directory
                        .join("node_modules")
                        .join("opencode-ai")
                        .join("bin")
                        .join("opencode.exe"),
                )
            });
            let native = native.ok_or("OpenCode CLI was not found. Install it and reopen TABS.")?;
            Ok(Launch {
                executable: native.clone(),
                arguments: Vec::new(),
                display_path: PathBuf::from(cli_path(&native)),
            })
        }
        _ => Err("Unsupported CLI provider."),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::cli_path;

    #[cfg(windows)]
    #[test]
    fn turns_verified_windows_verbatim_paths_into_cli_arguments() {
        assert_eq!(
            cli_path(Path::new(r"\\?\C:\npm\index.mjs")),
            r"C:\npm\index.mjs"
        );
        assert_eq!(
            cli_path(Path::new(r"\\?\UNC\server\share\file")),
            r"\\server\share\file"
        );
    }
}
