//! Pure validation helpers for Phase 3 security-boundary hardening.
//!
//! These are intentionally not wired into IPC commands in WP1. Later work
//! packages can call them from Tauri command entrypoints before privileged work.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EndpointClass {
    Loopback,
    Remote,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EndpointUrlPolicy {
    pub class: EndpointClass,
    pub frontend_direct_allowed: bool,
}

const KNOWN_ENDPOINT_KINDS: &[&str] = &["ollama", "openai", "lmstudio", "gemini", "custom", "a2a"];
const KNOWN_WEBMCP_TOOLS: &[&str] = &["graph.search", "graph.note", "ui.render", "browser.open"];
const KNOWN_SECRET_NAMES: &[&str] = &[
    "OLLAMA_API_KEY",
    "OPENAI_API_KEY",
    "LMSTUDIO_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
];

pub const MAX_MESSAGES: usize = 64;
pub const MAX_MESSAGE_TEXT_LENGTH: usize = 20_000;
pub const MIN_TEMPERATURE: f64 = 0.0;
pub const MAX_TEMPERATURE: f64 = 2.0;
pub const MIN_CONTEXT_WINDOW: u32 = 512;
pub const MAX_CONTEXT_WINDOW: u32 = 262_144;
pub const MAX_MODEL_NAME_LENGTH: usize = 128;
pub const MAX_SECRET_NAME_LENGTH: usize = 64;

#[derive(Debug, Clone)]
pub struct ModelMessage<'a> {
    pub content: &'a str,
}

pub fn validate_endpoint_kind(kind: &str) -> Result<(), String> {
    if KNOWN_ENDPOINT_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err("unknown endpoint kind".to_string())
    }
}

pub fn validate_endpoint_url(raw: &str) -> Result<EndpointUrlPolicy, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("endpoint URL is required".to_string());
    }
    if s.chars().any(char::is_whitespace) {
        return Err("malformed endpoint URL".to_string());
    }
    if s.to_ascii_lowercase().starts_with("file://") {
        return Err("file URLs are not allowed for endpoints".to_string());
    }

    let (scheme, rest) = s
        .split_once("://")
        .ok_or_else(|| "malformed endpoint URL".to_string())?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err("endpoint URL must use http or https".to_string());
    }

    let authority = rest.split('/').next().unwrap_or("");
    if authority.is_empty() {
        return Err("malformed endpoint URL".to_string());
    }
    if authority.contains('@') {
        return Err("endpoint URL must not include credentials".to_string());
    }

    let host = authority_host(authority)?;
    let is_loopback = host == "localhost" || host == "127.0.0.1" || host == "::1";
    if is_loopback && scheme != "http" {
        return Err("loopback endpoints must use http".to_string());
    }

    Ok(EndpointUrlPolicy {
        class: if is_loopback {
            EndpointClass::Loopback
        } else {
            EndpointClass::Remote
        },
        frontend_direct_allowed: is_loopback && scheme == "http",
    })
}

fn authority_host(authority: &str) -> Result<String, String> {
    if let Some(rest) = authority.strip_prefix('[') {
        let (host, tail) = rest
            .split_once(']')
            .ok_or_else(|| "malformed endpoint URL".to_string())?;
        if !tail.is_empty() && !tail.starts_with(':') {
            return Err("malformed endpoint URL".to_string());
        }
        return Ok(host.to_ascii_lowercase());
    }
    Ok(authority
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase())
}

pub fn validate_model_request_bounds(
    model: &str,
    temperature: f64,
    context_window: u32,
    messages: &[ModelMessage<'_>],
) -> Result<(), String> {
    if model.is_empty() {
        return Err("model name is required".to_string());
    }
    if model.len() > MAX_MODEL_NAME_LENGTH {
        return Err("model name is too long".to_string());
    }
    if !model
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '@' | '+' | '-'))
    {
        return Err("model name contains unsupported characters".to_string());
    }
    if !temperature.is_finite() || !(MIN_TEMPERATURE..=MAX_TEMPERATURE).contains(&temperature) {
        return Err("temperature is outside the allowed range".to_string());
    }
    if !(MIN_CONTEXT_WINDOW..=MAX_CONTEXT_WINDOW).contains(&context_window) {
        return Err("context window is outside the allowed range".to_string());
    }
    if messages.len() > MAX_MESSAGES {
        return Err("too many messages".to_string());
    }
    if messages
        .iter()
        .any(|msg| msg.content.len() > MAX_MESSAGE_TEXT_LENGTH)
    {
        return Err("message content is too long".to_string());
    }
    Ok(())
}

pub fn validate_secret_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("secret name is required".to_string());
    }
    if name.len() > MAX_SECRET_NAME_LENGTH {
        return Err("secret name is too long".to_string());
    }
    if !is_env_var_style(name) {
        return Err("secret name must be env-var style".to_string());
    }
    if KNOWN_SECRET_NAMES.contains(&name) || is_env_var_style(name) {
        Ok(())
    } else {
        Err("secret name is not allowed".to_string())
    }
}

fn is_env_var_style(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_uppercase()
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

pub fn validate_webmcp_tool_name(name: &str) -> Result<(), String> {
    if KNOWN_WEBMCP_TOOLS.contains(&name) {
        Ok(())
    } else {
        Err("unknown WebMCP tool".to_string())
    }
}

pub fn redact_secrets(input: &str) -> String {
    let mut out = Vec::new();
    let mut redact_next_bearer_value = false;

    for word in input.split_whitespace() {
        if redact_next_bearer_value {
            out.push("[REDACTED]".to_string());
            redact_next_bearer_value = false;
            continue;
        }

        let lower = word.to_ascii_lowercase();
        if lower == "bearer" {
            out.push("Bearer".to_string());
            redact_next_bearer_value = true;
            continue;
        }
        if lower.starts_with("bearer") && word.len() > "bearer".len() {
            out.push("Bearer [REDACTED]".to_string());
            continue;
        }
        if lower.starts_with("sk-") && word.len() > 12 {
            out.push("sk-[REDACTED]".to_string());
            continue;
        }

        if let Some((key, _)) = word.split_once('=') {
            let k = key.to_ascii_lowercase();
            if matches!(
                k.as_str(),
                "token" | "secret" | "password" | "api_key" | "api-key" | "apikey"
            ) {
                out.push(format!("{key}=[REDACTED]"));
                continue;
            }
        }

        out.push(word.to_string());
    }

    out.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_loopback_endpoint() {
        for raw in ["http://localhost:11434", "http://127.0.0.1:1234", "http://[::1]:8000"] {
            let policy = validate_endpoint_url(raw).unwrap();
            assert_eq!(policy.class, EndpointClass::Loopback);
            assert!(policy.frontend_direct_allowed);
        }
    }

    #[test]
    fn rejects_bad_endpoint_urls() {
        assert!(validate_endpoint_url("file:///C:/secret.txt").is_err());
        assert!(validate_endpoint_url("not a url").is_err());
        assert!(validate_endpoint_url("https://user:pass@example.com").is_err());
    }

    #[test]
    fn remote_http_is_not_frontend_direct() {
        let policy = validate_endpoint_url("https://api.example.com/v1").unwrap();
        assert_eq!(policy.class, EndpointClass::Remote);
        assert!(!policy.frontend_direct_allowed);
    }

    #[test]
    fn rejects_unknown_endpoint_kind() {
        assert!(validate_endpoint_kind("unknown").is_err());
    }

    #[test]
    fn validates_model_bounds_without_echoing_content() {
        let content = "x".repeat(MAX_MESSAGE_TEXT_LENGTH + 1);
        let err = validate_model_request_bounds(
            "llama3.1",
            0.7,
            8192,
            &[ModelMessage { content: &content }],
        )
        .unwrap_err();
        assert!(err.contains("too long"));
        assert!(!err.contains('x'));
        assert!(validate_model_request_bounds("llama3.1", 3.0, 8192, &[]).is_err());
        assert!(validate_model_request_bounds("llama3.1", 0.7, 1, &[]).is_err());
    }

    #[test]
    fn rejects_invalid_secret_names() {
        for name in ["../OPENAI_API_KEY", "BAD KEY", "TOKEN;rm", "x"] {
            assert!(validate_secret_name(name).is_err());
        }
    }

    #[test]
    fn validates_webmcp_tool_name() {
        assert!(validate_webmcp_tool_name("graph.search").is_ok());
        assert!(validate_webmcp_tool_name("shell.exec").is_err());
    }

    #[test]
    fn redacts_secret_like_values() {
        let redacted = redact_secrets("token=abc123 Bearer xyz.abc.123 sk-abcdefghijklmnopqrstuvwxyz");
        assert!(redacted.contains("token=[REDACTED]"));
        assert!(redacted.contains("Bearer [REDACTED]"));
        assert!(redacted.contains("sk-[REDACTED]"));
        assert!(!redacted.contains("abc123"));
        assert!(!redacted.contains("xyz.abc.123"));
    }
}
