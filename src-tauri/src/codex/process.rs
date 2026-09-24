use std::process::Child;

use super::protocol::{HostError, HostResult};

/// One unnamed Windows Job Object per TABS-owned child tree. The kill-on-close
/// limit prevents a launcher or native descendant from outliving its host.
#[cfg(windows)]
pub struct OwnedJob(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for OwnedJob {}
#[cfg(windows)]
unsafe impl Sync for OwnedJob {}

#[cfg(windows)]
impl OwnedJob {
    pub fn assign(child: &Child) -> HostResult<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(HostError::new(
                "internal",
                "Could not create Codex process job",
            ));
        }
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let set = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            )
        };
        let assigned =
            set != 0 && unsafe { AssignProcessToJobObject(handle, child.as_raw_handle()) } != 0;
        if !assigned {
            unsafe { CloseHandle(handle) };
            return Err(HostError::new(
                "internal",
                "Could not assign Codex process to its job",
            ));
        }
        Ok(Self(handle))
    }

    pub fn terminate(&self) {
        unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1) };
    }
}

#[cfg(windows)]
impl Drop for OwnedJob {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[cfg(not(windows))]
pub struct OwnedJob;

#[cfg(not(windows))]
impl OwnedJob {
    pub fn assign(_child: &Child) -> HostResult<Self> {
        Err(HostError::new(
            "internal",
            "Codex process ownership requires Windows",
        ))
    }
    pub fn terminate(&self) {}
}
