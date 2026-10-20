//! Network-free synthetic app-server fixture, built ONLY by the scratch test harness.
//! Not part of the TABS module or a command exposed to the application.
use serde_json::{json, Value};
use std::io::{BufRead, Write};
fn emit(v: Value) {
    println!("{v}");
    std::io::stdout().flush().unwrap();
}
fn main() {
    let home = std::path::PathBuf::from(std::env::var_os("CODEX_HOME").unwrap());
    assert_eq!(std::env::var_os("HOME"), std::env::var_os("CODEX_HOME"));
    assert!(std::env::var_os("OPENAI_API_KEY").is_none());
    let mode = std::fs::read_to_string(home.join("fixture-mode")).unwrap_or_default();
    let mut authenticated = false;
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let v: Value = serde_json::from_str(&line).unwrap();
        let method = v["method"].as_str().unwrap();
        let mut transcript = std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(home.join("fixture-methods"))
            .unwrap();
        writeln!(transcript, "{method}").unwrap();
        let Some(id) = v.get("id") else { continue };
        let result = match method {
            "initialize" => {
                json!({"userAgent":"synthetic-fixture","platformFamily":"windows","platformOs":"windows"})
            }
            "account/read" => {
                if authenticated {
                    json!({"account":{"type":"chatgpt","email":"synthetic@example.test","planType":"plus"},"requiresOpenaiAuth":true})
                } else {
                    json!({"account":null,"requiresOpenaiAuth":true})
                }
            }
            "account/rateLimits/read" => json!({"rateLimits":{}}),
            "account/login/start" => {
                let login = format!("fixture-{}", std::process::id());
                if mode == "complete" || mode == "failure" {
                    authenticated = mode == "complete";
                    // Intentionally BEFORE the request response: must not be lost.
                    emit(
                        json!({"method":"account/login/completed","params":{"loginId":login,"success":authenticated,"error":"synthetic error deliberately not surfaced"}}),
                    );
                }
                json!({"type":"chatgpt","loginId":login,"authUrl":"https://auth.openai.com/oauth/authorize?state=synthetic-fixture"})
            }
            "account/login/cancel" => json!({"status":"canceled"}),
            _ => panic!("unexpected operation in account-only fixture"),
        };
        emit(json!({"id":id,"result":result}));
    }
}
