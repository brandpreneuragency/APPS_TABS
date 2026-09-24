use super::{AuthState, CliModel};

fn plain_text(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut characters = input.chars();
    while let Some(character) = characters.next() {
        if character == '\u{1b}' {
            if characters.next() == Some('[') {
                for code in characters.by_ref() {
                    if ('@'..='~').contains(&code) {
                        break;
                    }
                }
            }
            continue;
        }
        if character != '\r' {
            output.push(character);
        }
    }
    output
}

fn valid_model_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 160
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:/+-".contains(&byte))
}

fn display_name(id: &str) -> String {
    id.to_owned()
}

pub(super) fn grok_auth_and_models(input: &str) -> (AuthState, Vec<CliModel>) {
    let clean = plain_text(input);
    let lower = clean.to_ascii_lowercase();
    let auth_state = if lower.contains("not logged in") || lower.contains("not authenticated") {
        AuthState::NotAuthenticated
    } else if lower.contains("you are logged in") || lower.contains("logged in with") {
        AuthState::Authenticated
    } else {
        AuthState::Unknown
    };
    let mut default_model = None;
    let mut in_models = false;
    let mut models = Vec::new();
    for line in clean.lines().map(str::trim) {
        if let Some(value) = line.strip_prefix("Default model:") {
            let id = value.split_whitespace().next().unwrap_or_default();
            if valid_model_id(id) {
                default_model = Some(id.to_owned());
            }
            continue;
        }
        if line == "Available models:" {
            in_models = true;
            continue;
        }
        if !in_models {
            continue;
        }
        let Some(value) = line.strip_prefix('*').or_else(|| line.strip_prefix('-')) else {
            continue;
        };
        let id = value.split_whitespace().next().unwrap_or_default();
        if valid_model_id(id) && !models.iter().any(|model: &CliModel| model.id == id) {
            let mut model = CliModel::new(
                id,
                Some(id) == default_model.as_deref() || line.contains("(default)"),
            );
            model.reasoning_efforts = grok_reasoning_efforts(id);
            models.push(model);
        }
    }
    (auth_state, models)
}

fn grok_reasoning_efforts(id: &str) -> Vec<String> {
    match id {
        "grok-4.7" | "grok-4.6" => vec!["low", "medium", "high", "xhigh"],
        "grok-4.5" => vec!["low", "medium", "high"],
        _ => return Vec::new(),
    }
    .into_iter()
    .map(str::to_owned)
    .collect()
}

pub(super) fn command_code_auth(input: &str) -> AuthState {
    let clean = plain_text(input);
    let Ok(value) = serde_json::from_str::<serde_json::Value>(clean.trim()) else {
        return AuthState::Unknown;
    };
    match value
        .get("authenticated")
        .and_then(serde_json::Value::as_bool)
    {
        Some(true) => AuthState::Authenticated,
        Some(false) => AuthState::NotAuthenticated,
        None => AuthState::Unknown,
    }
}

pub(super) fn command_code_models(input: &str) -> Vec<CliModel> {
    let clean = plain_text(input);
    let mut models = Vec::new();
    let mut in_models = false;
    for line in clean.lines().map(str::trim) {
        if line.starts_with("Available models") {
            in_models = true;
            continue;
        }
        if line.starts_with("Pass the full id") || line.starts_with("Docs:") {
            break;
        }
        if !in_models {
            continue;
        }
        let id = line.split_whitespace().next().unwrap_or_default();
        if !line
            .strip_prefix(id)
            .is_some_and(|description| description.starts_with("  "))
            || id.contains("://")
            || !valid_model_id(id)
            || id.starts_with("typesafe/jev")
        {
            continue;
        }
        if models.iter().any(|model: &CliModel| model.id == id) {
            continue;
        }
        models.push(CliModel::new(id, line.contains("(default)")));
    }
    models
}

/// Applies the exact per-model effort levels from Command Code's bundled
/// model reference. The table is generated from the same registry as the
/// installed CLI's model picker, and rows that no longer match are ignored.
pub(super) fn enrich_command_code_models_with_docs(models: &mut [CliModel], input: &str) {
    for line in input.lines().map(str::trim) {
        if !line.starts_with('|') || !line.ends_with('|') {
            continue;
        }
        let columns: Vec<_> = line.trim_matches('|').split('|').map(str::trim).collect();
        let Some(id) = columns.first().and_then(|column| {
            column
                .strip_prefix('`')
                .and_then(|value| value.strip_suffix('`'))
        }) else {
            continue;
        };
        let Some(efforts) = columns.get(3).map(|column| command_code_efforts(column)) else {
            continue;
        };
        if let Some(model) = models
            .iter_mut()
            .find(|model| model.id.eq_ignore_ascii_case(id))
        {
            model.reasoning_efforts = efforts;
        }
    }
}

fn command_code_efforts(column: &str) -> Vec<String> {
    column
        .split(',')
        .map(str::trim)
        .filter(|effort| {
            matches!(
                *effort,
                "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
            )
        })
        .map(str::to_owned)
        .collect()
}

pub(super) fn open_code_auth(input: &str) -> AuthState {
    let clean = plain_text(input);
    let mut found_count = false;
    let mut total = 0usize;
    for line in clean.lines() {
        let words: Vec<_> = line.split_whitespace().collect();
        for pair in words.windows(2) {
            if pair[1].starts_with("credential") || pair[1].starts_with("environment") {
                if let Ok(count) = pair[0].parse::<usize>() {
                    found_count = true;
                    total = total.saturating_add(count);
                }
            }
        }
    }
    if !found_count {
        AuthState::Unknown
    } else if total > 0 {
        AuthState::Authenticated
    } else {
        AuthState::NotAuthenticated
    }
}

pub(super) fn open_code_models(input: &str) -> Vec<CliModel> {
    let clean = plain_text(input);
    let mut models = Vec::new();
    for line in clean.lines().map(str::trim) {
        if line.contains(char::is_whitespace) || !line.contains('/') || !valid_model_id(line) {
            continue;
        }
        if !models.iter().any(|model: &CliModel| model.id == line) {
            models.push(CliModel::new(line, false));
        }
    }
    models
}

/// Enriches models from `opencode models --pure` with per-model variants from
/// the optional `--verbose` form. A malformed verbose response leaves the
/// already safe, simple model list unchanged.
pub(super) fn enrich_open_code_models_with_verbose(models: &mut [CliModel], input: &str) {
    let clean = plain_text(input);
    let mut pending_model_id: Option<String> = None;
    let mut byte_offset = 0usize;

    for line_with_ending in clean.split_inclusive('\n') {
        let line = line_with_ending.trim();
        let line_start = byte_offset + line_with_ending.find(line).unwrap_or(0);
        byte_offset += line_with_ending.len();

        if line.contains('/') && !line.contains(char::is_whitespace) && valid_model_id(line) {
            pending_model_id = Some(line.to_owned());
            continue;
        }
        if line != "{" {
            continue;
        }
        let Some(model_id) = pending_model_id.take() else {
            continue;
        };
        let Some(value) = parse_json_value(&clean[line_start..]) else {
            continue;
        };
        let efforts = value
            .get("variants")
            .and_then(serde_json::Value::as_object)
            .map(recognized_variant_efforts)
            .unwrap_or_default();
        if efforts.is_empty() {
            continue;
        }
        if let Some(model) = models.iter_mut().find(|model| model.id == model_id) {
            model.reasoning_efforts = efforts;
        }
    }
}

fn parse_json_value(input: &str) -> Option<serde_json::Value> {
    serde_json::Deserializer::from_str(input)
        .into_iter::<serde_json::Value>()
        .next()?
        .ok()
}

fn recognized_variant_efforts(
    variants: &serde_json::Map<String, serde_json::Value>,
) -> Vec<String> {
    ["minimal", "low", "medium", "high", "xhigh", "max"]
        .into_iter()
        .filter(|name| variants.contains_key(*name))
        .map(str::to_owned)
        .collect()
}

impl CliModel {
    fn new(id: &str, is_default: bool) -> Self {
        Self {
            id: id.to_owned(),
            display_name: display_name(id),
            is_default,
            reasoning_efforts: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        command_code_auth, command_code_models, enrich_command_code_models_with_docs,
        enrich_open_code_models_with_verbose, grok_auth_and_models, open_code_auth,
        open_code_models,
    };
    use crate::cli_providers::AuthState;

    #[test]
    fn parses_grok_login_and_default_without_exposing_other_text() {
        let fixture = "You are logged in with grok.com.\nDefault model: grok-4.7\nAvailable models:\n  * grok-4.7 (default)\n  - grok-4.7-build-fast\n";
        let (auth, models) = grok_auth_and_models(fixture);
        assert_eq!(auth, AuthState::Authenticated);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "grok-4.7");
        assert!(models[0].is_default);
        assert_eq!(
            models[0].reasoning_efforts,
            ["low", "medium", "high", "xhigh"]
        );
        assert_eq!(
            grok_auth_and_models("Not logged in\nAvailable models:\n- grok-4.7\n").0,
            AuthState::NotAuthenticated
        );
    }

    #[test]
    fn parses_command_code_json_and_excludes_non_chat_tool() {
        assert_eq!(
            command_code_auth(r#"{"authenticated":true,"user":{"email":"hidden@example.com"}}"#),
            AuthState::Authenticated
        );
        assert_eq!(
            command_code_auth(r#"{"authenticated":false}"#),
            AuthState::NotAuthenticated
        );
        let fixture = "Available models  ·  4 models\n\nOpen Source\n\ndeepseek/deepseek-v4-flash    fast (default)\ntypesafe/jev                system tool\nAnthropic\n\nclaude-sonnet-5            recommended\nOpenAI\n\ngpt-6-astra                capable\nxai/grok-4.6               coding\nPass the full id, or just the short name:\nDocs:  https://example.com\n";
        let models = command_code_models(fixture);
        assert_eq!(models.len(), 4);
        assert!(models[0].is_default);
        assert_eq!(models[1].id, "claude-sonnet-5");
        assert_eq!(models[2].id, "gpt-6-astra");
        assert_eq!(models[3].id, "xai/grok-4.6");
    }

    #[test]
    fn enriches_command_code_models_only_from_exact_documented_rows() {
        let mut models = command_code_models(
            "Available models  ·  3 models\n\nclaude-sonnet-5  recommended\n\ngpt-6-astra  capable\n\nunknown-model  unavailable\n\nDocs:\n",
        );
        enrich_command_code_models_with_docs(
            &mut models,
            "| Id | Name | Context | Efforts |\n|---|---|---|---|\n| `claude-sonnet-5` | Claude | 1M | low, medium, high, xhigh, max |\n| `gpt-6-astra` | GPT | 1M | low, medium, high, xhigh, max |\n| `different-model` | Other | 1M | low, high |\n",
        );
        assert_eq!(
            models[0].reasoning_efforts,
            ["low", "medium", "high", "xhigh", "max"]
        );
        assert_eq!(
            models[1].reasoning_efforts,
            ["low", "medium", "high", "xhigh", "max"]
        );
        assert!(models[2].reasoning_efforts.is_empty());
    }

    #[test]
    fn parses_opencode_credential_count_and_model_ids() {
        assert_eq!(
            open_code_auth("Credentials\n— 7 credentials\nEnvironment\n— 1 environment variable\n"),
            AuthState::Authenticated
        );
        assert_eq!(
            open_code_auth("— 0 credentials\n— 0 environment variables\n"),
            AuthState::NotAuthenticated
        );
        assert_eq!(open_code_auth("unexpected"), AuthState::Unknown);
        let models = open_code_models(
            "opencode/big-pickle\nopencode/claude-opus-4-7\nnot a model\nopencode/big-pickle\n",
        );
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "opencode/big-pickle");
    }

    #[test]
    fn enriches_opencode_models_from_verbose_variants_only() {
        let mut models = open_code_models("openai/gpt-6\nantigravity/claude\n");
        enrich_open_code_models_with_verbose(
            &mut models,
            r#"openai/gpt-6
{
  "variants": {
    "minimal": {},
    "high": {},
    "turbo": {}
  }
}
antigravity/claude
{
  "variants": {
    "max": {}
  }
}
"#,
        );
        assert_eq!(models[0].reasoning_efforts, ["minimal", "high"]);
        assert_eq!(models[1].reasoning_efforts, ["max"]);
    }

    #[test]
    fn ignores_malformed_opencode_verbose_blocks() {
        let mut models = open_code_models("openai/gpt-6\n");
        enrich_open_code_models_with_verbose(&mut models, "openai/gpt-6\n{\n  \"variants\": {\n");
        assert!(models[0].reasoning_efforts.is_empty());
    }
}
