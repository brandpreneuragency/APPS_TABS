//! Opens only the current Codex login URL through the OS, never through a shell.

pub(super) fn open(url: &str) -> Result<(), String> {
    if !super::client::valid_auth_url(url) {
        return Err("Codex returned an unsafe login URL".into());
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        let operation: Vec<u16> = "open\0".encode_utf16().collect();
        let target: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
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
            return Err("Could not open Codex login in the system browser".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    Err("Codex account login currently requires Windows".into())
}
