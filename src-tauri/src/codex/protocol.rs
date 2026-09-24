use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
pub const MAX_TEXT_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostError {
    pub code: &'static str,
    pub message: String,
}

impl HostError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub type HostResult<T> = Result<T, HostError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum HostEventKind {
    Status {
        status: String,
        message: Option<String>,
    },
    TextDelta {
        thread_id: String,
        turn_id: String,
        item_id: String,
        delta: String,
    },
    TurnStatus {
        thread_id: String,
        turn_id: String,
        status: String,
    },
    ToolActivity {
        thread_id: String,
        turn_id: String,
        item_id: String,
        item_type: String,
        status: Option<String>,
        details: Value,
    },
    Request {
        request: PendingRequestView,
    },
    Diagnostic {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostEvent {
    pub epoch: u64,
    pub sequence: u64,
    #[serde(flatten)]
    pub event: HostEventKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRequestView {
    pub request_id: String,
    pub kind: String,
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: Option<String>,
    pub call_id: Option<String>,
    pub tool_name: Option<String>,
    pub details: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Replay {
    pub events: Vec<HostEvent>,
    pub latest_sequence: u64,
    pub gap: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RequestReply {
    FileChangeApproval {
        decision: ApprovalDecision,
    },
    CommandApproval {
        decision: ApprovalDecision,
    },
    Question {
        answers: std::collections::HashMap<String, Vec<String>>,
    },
    BusinessTool {
        success: bool,
        text: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalDecision {
    Accept,
    Decline,
    Cancel,
}

pub struct JsonlDecoder {
    pending: Vec<u8>,
}

impl JsonlDecoder {
    pub fn new() -> Self {
        Self {
            pending: Vec::new(),
        }
    }

    pub fn push(&mut self, bytes: &[u8]) -> HostResult<Vec<Value>> {
        let mut messages = Vec::new();
        for &byte in bytes {
            if byte == b'\n' {
                if self.pending.last() == Some(&b'\r') {
                    self.pending.pop();
                }
                if !self.pending.is_empty() {
                    let frame = std::str::from_utf8(&self.pending).map_err(|_| {
                        HostError::new("protocol_error", "Invalid UTF-8 in Codex output")
                    })?;
                    let value: Value = serde_json::from_str(frame).map_err(|_| {
                        HostError::new("protocol_error", "Malformed Codex JSONL frame")
                    })?;
                    if !value.is_object() {
                        return Err(HostError::new(
                            "protocol_error",
                            "Codex frame is not an object",
                        ));
                    }
                    messages.push(value);
                    self.pending.clear();
                }
            } else {
                if self.pending.len() >= MAX_FRAME_BYTES {
                    self.pending.clear();
                    return Err(HostError::new(
                        "protocol_error",
                        "Codex JSONL frame exceeds limit",
                    ));
                }
                self.pending.push(byte);
            }
        }
        Ok(messages)
    }

    pub fn finish(&self) -> HostResult<()> {
        if self.pending.is_empty() {
            Ok(())
        } else {
            Err(HostError::new(
                "protocol_error",
                "Incomplete Codex JSONL frame at EOF",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_fragmented_utf8_and_crlf() {
        let mut d = JsonlDecoder::new();
        let b = "{\"method\":\"é\"}\r\n".as_bytes();
        assert!(d.push(&b[..12]).unwrap().is_empty());
        let values = d.push(&b[12..]).unwrap();
        assert_eq!(values[0]["method"], "é");
        assert!(d.finish().is_ok());
    }

    #[test]
    fn rejects_malformed_oversized_and_eof() {
        let mut d = JsonlDecoder::new();
        assert_eq!(d.push(b"{bad}\n").unwrap_err().code, "protocol_error");
        let mut d = JsonlDecoder::new();
        assert_eq!(
            d.push(&vec![b'x'; MAX_FRAME_BYTES + 1]).unwrap_err().code,
            "protocol_error"
        );
        let mut d = JsonlDecoder::new();
        d.push(b"{\"id\":1}").unwrap();
        assert_eq!(d.finish().unwrap_err().code, "protocol_error");
    }
}
