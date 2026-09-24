use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::codex::CliOwnedJob;

use super::discovery::Launch;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProcessError {
    Start,
    Ownership,
    Timeout,
    OutputLimit,
    Read,
}

#[derive(Debug)]
pub(crate) struct ProcessOutput {
    pub stdout: String,
    pub status: ExitStatus,
}

/// Launches the resolved executable directly. No shell or npm shim is run.
/// The Windows job owns the complete child tree, including Node descendants.
pub(crate) fn run_bounded(
    launch: &Launch,
    arguments: &[&str],
    timeout: Duration,
    output_limit: usize,
) -> Result<ProcessOutput, ProcessError> {
    let mut command = Command::new(&launch.executable);
    command
        .args(&launch.arguments)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|_| ProcessError::Start)?;
    let job = match CliOwnedJob::assign(&child) {
        Ok(job) => job,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ProcessError::Ownership);
        }
    };
    let stdout = child.stdout.take().ok_or(ProcessError::Read)?;
    let stderr = child.stderr.take().ok_or(ProcessError::Read)?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(output_limit as u64 + 1)
            .read_to_end(&mut bytes)?;
        Ok::<_, std::io::Error>(bytes)
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr
            .take(output_limit as u64 + 1)
            .read_to_end(&mut bytes)?;
        Ok::<_, std::io::Error>(bytes)
    });

    let deadline = Instant::now() + timeout;
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) => break Err(ProcessError::Timeout),
            Err(_) => break Err(ProcessError::Read),
        }
    };
    if result.is_err() {
        job.terminate();
        let _ = child.wait();
    }
    // Closing the job also closes inherited output handles in descendants.
    drop(job);
    let stdout = stdout_reader
        .join()
        .map_err(|_| ProcessError::Read)?
        .map_err(|_| ProcessError::Read)?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| ProcessError::Read)?
        .map_err(|_| ProcessError::Read)?;
    let status = result?;
    if stdout.len() > output_limit || stderr.len() > output_limit {
        return Err(ProcessError::OutputLimit);
    }
    let _ = stderr;
    Ok(ProcessOutput {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        status,
    })
}

#[cfg(all(test, windows))]
mod tests {
    use std::ffi::OsString;
    use std::time::Duration;

    use super::{run_bounded, ProcessError};
    use crate::cli_providers::discovery::Launch;

    #[test]
    fn slow_child() {
        std::thread::sleep(Duration::from_millis(300));
    }

    #[test]
    fn terminates_a_timed_out_child() {
        let executable = std::env::current_exe().unwrap();
        let launch = Launch {
            executable: executable.clone(),
            arguments: vec![
                OsString::from("--exact"),
                OsString::from("cli_providers::process::tests::slow_child"),
            ],
            display_path: executable,
        };
        let result = run_bounded(&launch, &[], Duration::from_millis(40), 4096);
        assert_eq!(result.unwrap_err(), ProcessError::Timeout);
    }
}
