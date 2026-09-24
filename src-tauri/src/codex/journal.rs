use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::protocol::{HostEvent, HostResult, Replay};
use super::HostError;

const MAX_JOURNAL_BYTES: u64 = 64 * 1024 * 1024;
const COMPACT_AFTER_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalState {
    epoch: u64,
    sequence: u64,
    ack_sequence: u64,
    epoch_first_sequence: u64,
}

pub struct Journal {
    folder: PathBuf,
    file: Option<File>,
    state: JournalState,
}

impl Journal {
    pub fn open(folder: &Path) -> HostResult<Self> {
        fs::create_dir_all(folder).map_err(|_| fault())?;
        let state_path = folder.join("state.json");
        let mut state: JournalState = if state_path.exists() {
            let bytes = fs::read(&state_path).map_err(|_| fault())?;
            serde_json::from_slice(&bytes).map_err(|_| fault())?
        } else {
            JournalState::default()
        };
        let event_path = folder.join("events.jsonl");
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&event_path)
            .map_err(|_| fault())?;
        if file.metadata().map_err(|_| fault())?.len() > MAX_JOURNAL_BYTES {
            return Err(fault());
        }
        let mut last_sequence = 0;
        let mut max_epoch = state.epoch;
        let reader = BufReader::new(File::open(&event_path).map_err(|_| fault())?);
        for line in reader.lines() {
            let line = line.map_err(|_| fault())?;
            if line.len() > super::protocol::MAX_FRAME_BYTES {
                return Err(fault());
            }
            let event: HostEvent = serde_json::from_str(&line).map_err(|_| fault())?;
            if event.sequence <= last_sequence {
                return Err(fault());
            }
            last_sequence = event.sequence;
            max_epoch = max_epoch.max(event.epoch);
        }
        state.sequence = state.sequence.max(last_sequence);
        state.epoch = state.epoch.max(max_epoch);
        if state.epoch_first_sequence == 0 {
            state.epoch_first_sequence = state.sequence.saturating_add(1);
        }
        Ok(Self {
            folder: folder.to_owned(),
            file: Some(file),
            state,
        })
    }

    pub fn counters(&self) -> (u64, u64) {
        (self.state.epoch, self.state.sequence)
    }

    pub fn next_epoch(&mut self) -> HostResult<u64> {
        self.state.epoch = self.state.epoch.checked_add(1).ok_or_else(fault)?;
        self.state.epoch_first_sequence = self.state.sequence.saturating_add(1);
        self.persist_state()?;
        Ok(self.state.epoch)
    }

    pub fn append(&mut self, event: &HostEvent) -> HostResult<()> {
        let mut bytes = serde_json::to_vec(event).map_err(|_| fault())?;
        if bytes.len() > super::protocol::MAX_FRAME_BYTES {
            return Err(fault());
        }
        bytes.push(b'\n');
        let file = self.file.as_mut().ok_or_else(fault)?;
        let size = file.metadata().map_err(|_| fault())?.len();
        if size.saturating_add(bytes.len() as u64) > MAX_JOURNAL_BYTES {
            return Err(fault());
        }
        file.write_all(&bytes)
            .and_then(|_| file.sync_data())
            .map_err(|_| fault())?;
        self.state.sequence = event.sequence;
        Ok(())
    }

    pub fn replay(&self, epoch: u64, after_sequence: u64, limit: usize) -> HostResult<Replay> {
        let reader =
            BufReader::new(File::open(self.folder.join("events.jsonl")).map_err(|_| fault())?);
        let mut events = Vec::new();
        let mut first_retained = None;
        for line in reader.lines() {
            let event: HostEvent =
                serde_json::from_str(&line.map_err(|_| fault())?).map_err(|_| fault())?;
            if event.epoch != epoch {
                continue;
            }
            first_retained.get_or_insert(event.sequence);
            if event.sequence > after_sequence && events.len() < limit {
                events.push(event);
            }
        }
        let gap = if epoch == self.state.epoch {
            first_retained.is_some_and(|first| {
                first > self.state.epoch_first_sequence && after_sequence < first.saturating_sub(1)
            }) || (first_retained.is_none()
                && self.state.ack_sequence >= self.state.epoch_first_sequence
                && after_sequence < self.state.ack_sequence)
        } else {
            false
        };
        Ok(Replay {
            events,
            latest_sequence: self.state.sequence,
            gap,
        })
    }

    pub fn ack(&mut self, epoch: u64, sequence: u64) -> HostResult<()> {
        if epoch != self.state.epoch || sequence > self.state.sequence {
            return Err(HostError::new(
                "stale_epoch",
                "Codex event acknowledgement is stale",
            ));
        }
        if sequence <= self.state.ack_sequence {
            return Ok(());
        }
        self.state.ack_sequence = sequence;
        self.persist_state()?;
        if self
            .file
            .as_ref()
            .ok_or_else(fault)?
            .metadata()
            .map_err(|_| fault())?
            .len()
            >= COMPACT_AFTER_BYTES
        {
            self.compact()?;
        }
        Ok(())
    }

    fn compact(&mut self) -> HostResult<()> {
        let path = self.folder.join("events.jsonl");
        let temp = self.folder.join("events.next");
        let mut output = File::create(&temp).map_err(|_| fault())?;
        let mut reader = BufReader::new(File::open(&path).map_err(|_| fault())?);
        let mut line = String::new();
        loop {
            line.clear();
            if reader.read_line(&mut line).map_err(|_| fault())? == 0 {
                break;
            }
            let event: HostEvent = serde_json::from_str(&line).map_err(|_| fault())?;
            if event.sequence > self.state.ack_sequence {
                output.write_all(line.as_bytes()).map_err(|_| fault())?;
            }
        }
        output.sync_all().map_err(|_| fault())?;
        drop(output);
        // Windows cannot replace an open destination. On a failed rename the old
        // journal is still present and re-opened before another event is accepted.
        self.file.take();
        if fs::rename(&temp, &path).is_err() {
            self.file = Some(
                OpenOptions::new()
                    .append(true)
                    .read(true)
                    .open(&path)
                    .map_err(|_| fault())?,
            );
            return Err(fault());
        }
        self.file = Some(
            OpenOptions::new()
                .append(true)
                .read(true)
                .open(&path)
                .map_err(|_| fault())?,
        );
        Ok(())
    }

    fn persist_state(&self) -> HostResult<()> {
        let temp = self.folder.join("state.next");
        let path = self.folder.join("state.json");
        let mut file = File::create(&temp).map_err(|_| fault())?;
        let bytes = serde_json::to_vec(&self.state).map_err(|_| fault())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| fault())?;
        drop(file);
        fs::rename(temp, path).map_err(|_| fault())
    }
}

fn fault() -> HostError {
    HostError::new(
        "internal",
        "Codex event journal is unavailable; AI execution is stopped",
    )
}

#[cfg(test)]
mod tests {
    use super::super::protocol::HostEventKind;
    use super::*;

    #[test]
    fn journal_reopens_with_monotonic_epoch_and_ack() {
        let dir = tempfile::tempdir().unwrap();
        let mut journal = Journal::open(dir.path()).unwrap();
        let epoch = journal.next_epoch().unwrap();
        let event = HostEvent {
            epoch,
            sequence: 1,
            event: HostEventKind::TurnStatus {
                thread_id: "synthetic-thread".into(),
                turn_id: "synthetic-turn".into(),
                status: "completed".into(),
            },
        };
        journal.append(&event).unwrap();
        assert_eq!(journal.replay(epoch, 0, 10).unwrap().events.len(), 1);
        journal.ack(epoch, 1).unwrap();
        drop(journal);

        let mut reopened = Journal::open(dir.path()).unwrap();
        assert_eq!(reopened.counters(), (epoch, 1));
        assert!(reopened
            .replay(epoch, 0, 10)
            .unwrap()
            .events
            .iter()
            .any(|row| row.sequence == 1));
        assert_eq!(reopened.next_epoch().unwrap(), epoch + 1);
    }

    #[test]
    fn corrupt_journal_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("events.jsonl"), b"{bad}\n").unwrap();
        assert_eq!(Journal::open(dir.path()).err().unwrap().code, "internal");
    }

    #[test]
    fn full_journal_rejects_event_without_advancing_sequence() {
        let dir = tempfile::tempdir().unwrap();
        let mut journal = Journal::open(dir.path()).unwrap();
        let epoch = journal.next_epoch().unwrap();
        journal.file.take();
        let path = dir.path().join("events.jsonl");
        let fill = OpenOptions::new().write(true).open(&path).unwrap();
        fill.set_len(MAX_JOURNAL_BYTES).unwrap();
        drop(fill);
        journal.file = Some(
            OpenOptions::new()
                .append(true)
                .read(true)
                .open(&path)
                .unwrap(),
        );
        let result = journal.append(&HostEvent {
            epoch,
            sequence: 1,
            event: HostEventKind::Diagnostic {
                message: "synthetic".into(),
            },
        });
        assert_eq!(result.err().unwrap().code, "internal");
        assert_eq!(journal.counters(), (epoch, 0));
    }

    #[test]
    fn compacted_acknowledged_events_report_a_replay_gap() {
        let dir = tempfile::tempdir().unwrap();
        let mut journal = Journal::open(dir.path()).unwrap();
        let epoch = journal.next_epoch().unwrap();
        for sequence in 1..=80 {
            journal
                .append(&HostEvent {
                    epoch,
                    sequence,
                    event: HostEventKind::Diagnostic {
                        message: "synthetic".repeat(7_500),
                    },
                })
                .unwrap();
        }
        journal.ack(epoch, 80).unwrap();
        assert!(journal.replay(epoch, 0, 10).unwrap().gap);
        drop(journal);
        let reopened = Journal::open(dir.path()).unwrap();
        assert_eq!(reopened.counters(), (epoch, 80));
        assert!(reopened.replay(epoch, 0, 10).unwrap().gap);
    }
}
