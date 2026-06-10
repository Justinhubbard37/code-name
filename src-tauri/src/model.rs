//! Cloud/model HTTP proxy (Phase 2).
//!
//! The webview cannot call cloud APIs directly — browser CORS blocks cross-site
//! requests, so a fetch from the page to e.g. https://ollama.com never reaches
//! the server. These commands make the request from the Rust shell via reqwest
//! (not a browser, so no CORS), reading the API key from the OS keychain here so
//! it never enters the webview. Local endpoints keep using the webview path.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use crate::sidecar::GateState;
use crate::validation::{
    redact_secrets, validate_endpoint_kind, validate_endpoint_url, validate_model_request_bounds,
    validate_secret_name, ModelMessage,
};

const SERVICE: &str = "com.codename.harness";

#[derive(Deserialize, Serialize)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelReq {
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub key_name: Option<String>,
    pub fallback_key: Option<String>,
    pub temperature: f64,
    pub num_ctx: u32,
    pub messages: Vec<ChatMsg>,
    pub cloud: bool,
}

/// Read the API key from the OS keychain by name; fall back to a value passed
/// from the webview (used only for env-var keys, not keychain keys).
fn read_key(key_name: &Option<String>, fallback: &Option<String>) -> Option<String> {
    if let Some(name) = key_name {
        if let Ok(entry) = keyring::Entry::new(SERVICE, name) {
            if let Ok(pw) = entry.get_password() {
                if !pw.is_empty() {
                    return Some(pw);
                }
            }
        }
    }
    fallback.clone().filter(|s| !s.is_empty())
}

fn sanitize_error(error: impl ToString) -> String {
    redact_secrets(&error.to_string())
}

fn validate_key_name(key_name: &Option<String>) -> Result<(), String> {
    if let Some(name) = key_name {
        validate_secret_name(name).map_err(sanitize_error)?;
    }
    Ok(())
}

fn validate_model_list_request(
    kind: &str,
    base_url: &str,
    key_name: &Option<String>,
) -> Result<(), String> {
    validate_endpoint_kind(kind).map_err(sanitize_error)?;
    validate_endpoint_url(base_url).map_err(sanitize_error)?;
    validate_key_name(key_name)?;
    Ok(())
}

fn validate_model_stream_request(req: &ModelReq) -> Result<(), String> {
    validate_endpoint_kind(&req.kind).map_err(sanitize_error)?;
    validate_endpoint_url(&req.base_url).map_err(sanitize_error)?;
    validate_key_name(&req.key_name)?;
    let messages = req
        .messages
        .iter()
        .map(|msg| ModelMessage {
            content: msg.content.as_str(),
        })
        .collect::<Vec<_>>();
    validate_model_request_bounds(&req.model, req.temperature, req.num_ctx, &messages)
        .map_err(sanitize_error)
}

async fn http_error(resp: reqwest::Response, model: &str) -> String {
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    let detail = sanitize_error(body.chars().take(200).collect::<String>());
    let model = sanitize_error(model);
    let missing = status == 404 || detail.to_lowercase().contains("not found");
    if missing {
        format!("model \"{model}\" not found at this endpoint (HTTP {status})")
    } else if detail.trim().is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status}: {}", detail.trim())
    }
}

/// List the models available at an endpoint (cloud-safe; runs from the shell).
#[tauri::command]
pub async fn model_list(
    kind: String,
    base_url: String,
    key_name: Option<String>,
    fallback_key: Option<String>,
) -> Result<Vec<String>, String> {
    validate_model_list_request(&kind, &base_url, &key_name)?;
    let base = base_url.trim_end_matches('/');
    let key = read_key(&key_name, &fallback_key);
    let url = if kind == "ollama" {
        format!("{base}/api/tags")
    } else {
        format!("{base}/v1/models")
    };
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(sanitize_error)?;
    let mut rb = client.get(&url);
    if let Some(k) = &key {
        rb = rb.header("Authorization", format!("Bearer {k}"));
    }
    let resp = rb.send().await.map_err(sanitize_error)?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let v: serde_json::Value = resp.json().await.map_err(sanitize_error)?;
    let names: Vec<String> = if kind == "ollama" {
        v.get("models")
            .and_then(|m| m.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        v.get("data")
            .and_then(|d| d.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|m| m.get("id").and_then(|n| n.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    };
    Ok(names)
}

/// Stream a chat reply from a model endpoint, pushing tokens to the webview over
/// a Channel. Returns the model the server reported it actually ran.
#[tauri::command]
pub async fn model_stream(
    req: ModelReq,
    on_event: Channel<String>,
    gates: State<'_, GateState>,
) -> Result<String, String> {
    validate_model_stream_request(&req)?;
    if req.cloud && !gates.network_open() {
        return Err("network gate closed".to_string());
    }
    let base = req.base_url.trim_end_matches('/');
    let key = read_key(&req.key_name, &req.fallback_key);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(sanitize_error)?;

    let mut served = String::new();

    if req.kind == "ollama" {
        let body = serde_json::json!({
            "model": req.model,
            "messages": req.messages,
            "stream": true,
            "options": { "temperature": req.temperature, "num_ctx": req.num_ctx }
        });
        let mut rb = client.post(format!("{base}/api/chat")).json(&body);
        if let Some(k) = &key {
            rb = rb.header("Authorization", format!("Bearer {k}"));
        }
        let mut resp = rb.send().await.map_err(sanitize_error)?;
        if !resp.status().is_success() {
            return Err(http_error(resp, &req.model).await);
        }
        let mut buf = String::new();
        while let Some(chunk) = resp.chunk().await.map_err(sanitize_error)? {
            buf.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(idx) = buf.find('\n') {
                let line = buf[..idx].trim().to_string();
                buf = buf[idx + 1..].to_string();
                if line.is_empty() {
                    continue;
                }
                if let Ok(j) = serde_json::from_str::<serde_json::Value>(&line) {
                    if served.is_empty() {
                        if let Some(m) = j.get("model").and_then(|m| m.as_str()) {
                            served = m.to_string();
                        }
                    }
                    if let Some(tok) = j
                        .get("message")
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        if !tok.is_empty() {
                            on_event.send(tok.to_string()).map_err(sanitize_error)?;
                        }
                    }
                }
            }
        }
    } else {
        let body = serde_json::json!({
            "model": req.model,
            "messages": req.messages,
            "stream": true,
            "temperature": req.temperature
        });
        let mut rb = client
            .post(format!("{base}/v1/chat/completions"))
            .json(&body);
        if let Some(k) = &key {
            rb = rb.header("Authorization", format!("Bearer {k}"));
        }
        let mut resp = rb.send().await.map_err(sanitize_error)?;
        if !resp.status().is_success() {
            return Err(http_error(resp, &req.model).await);
        }
        let mut buf = String::new();
        while let Some(chunk) = resp.chunk().await.map_err(sanitize_error)? {
            buf.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(idx) = buf.find('\n') {
                let line = buf[..idx].trim().to_string();
                buf = buf[idx + 1..].to_string();
                if !line.starts_with("data:") {
                    continue;
                }
                let payload = line[5..].trim().to_string();
                if payload == "[DONE]" {
                    continue;
                }
                if let Ok(j) = serde_json::from_str::<serde_json::Value>(&payload) {
                    if served.is_empty() {
                        if let Some(m) = j.get("model").and_then(|m| m.as_str()) {
                            served = m.to_string();
                        }
                    }
                    if let Some(tok) = j
                        .get("choices")
                        .and_then(|c| c.get(0))
                        .and_then(|c| c.get("delta"))
                        .and_then(|d| d.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        if !tok.is_empty() {
                            on_event.send(tok.to_string()).map_err(sanitize_error)?;
                        }
                    }
                }
            }
        }
    }

    Ok(served)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_req() -> ModelReq {
        ModelReq {
            kind: "ollama".to_string(),
            base_url: "http://localhost:11434".to_string(),
            model: "llama3.1".to_string(),
            key_name: None,
            fallback_key: Some("sk-abcdefghijklmnopqrstuvwxyz".to_string()),
            temperature: 0.7,
            num_ctx: 8192,
            messages: vec![ChatMsg {
                role: "user".to_string(),
                content: "hello".to_string(),
            }],
            cloud: false,
        }
    }

    #[test]
    fn model_list_validation_rejects_unsafe_inputs_before_network() {
        assert!(
            validate_model_list_request("unknown", "http://localhost:11434", &None)
                .unwrap_err()
                .contains("unknown endpoint kind")
        );
        assert!(
            validate_model_list_request("ollama", "file:///C:/secret.txt", &None)
                .unwrap_err()
                .contains("file URLs")
        );
        assert!(
            validate_model_list_request("ollama", "https://user:pass@example.com", &None)
                .unwrap_err()
                .contains("credentials")
        );
        assert!(validate_model_list_request(
            "ollama",
            "http://localhost:11434",
            &Some("BAD KEY".to_string()),
        )
        .unwrap_err()
        .contains("env-var"));
    }

    #[test]
    fn model_stream_validation_rejects_invalid_request_bounds() {
        let mut req = valid_req();
        req.model = "bad model name".to_string();
        assert!(validate_model_stream_request(&req)
            .unwrap_err()
            .contains("model name"));

        let mut req = valid_req();
        req.messages[0].content = "x".repeat(crate::validation::MAX_MESSAGE_TEXT_LENGTH + 1);
        let err = validate_model_stream_request(&req).unwrap_err();
        assert!(err.contains("too long"));
        assert!(!err.contains('x'));

        let mut req = valid_req();
        req.temperature = 3.0;
        assert!(validate_model_stream_request(&req)
            .unwrap_err()
            .contains("temperature"));

        let mut req = valid_req();
        req.num_ctx = 1;
        assert!(validate_model_stream_request(&req)
            .unwrap_err()
            .contains("context"));
    }

    #[test]
    fn model_errors_are_sanitized() {
        let err = sanitize_error(
            "HTTP 401 Bearer xyz.abc.123 token=abc123 sk-abcdefghijklmnopqrstuvwxyz",
        );
        assert!(err.contains("Bearer [REDACTED]"));
        assert!(err.contains("token=[REDACTED]"));
        assert!(err.contains("sk-[REDACTED]"));
        assert!(!err.contains("xyz.abc.123"));
        assert!(!err.contains("abc123"));
    }
}
