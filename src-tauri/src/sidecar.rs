//! Python agent-sidecar supervisor (Phase 3).
//! Spawns the loopback A2A sidecar, reads its handshake (ephemeral port +
//! per-launch token) from stdout, holds it in managed state, and kills it on
//! app exit. The Rust shell owns the lifecycle (docs/contracts/sidecar.md).

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::validation::{redact_secrets, validate_sidecar_message};

#[derive(Default, Clone, Serialize)]
pub struct SidecarInfo {
    pub status: String, // stopped | starting | ready | error
    pub host: String,
    pub port: u16,
    // The per-launch bearer token stays inside the Rust shell — it is NEVER
    // serialized out to the webview (Phase 1 security spine).
    #[serde(skip)]
    pub token: String,
}

#[derive(Deserialize)]
struct Handshake {
    host: String,
    port: u16,
    token: String,
}

/// Capability gate state owned by the Rust shell (Phase 1.3). The webview keeps
/// this in sync via `set_gates`; the sidecar commands read it to enforce the
/// gates at the process level, so closing a gate severs the bridge even if a
/// UI-layer check is bypassed.
pub struct GateState {
    pub filesystem: AtomicBool,
    pub network: AtomicBool,
    pub tools: AtomicBool,
}

impl Default for GateState {
    fn default() -> Self {
        Self {
            filesystem: AtomicBool::new(true),
            network: AtomicBool::new(true),
            tools: AtomicBool::new(true),
        }
    }
}

impl GateState {
    pub fn tools_open(&self) -> bool {
        self.tools.load(Ordering::SeqCst)
    }
    pub fn network_open(&self) -> bool {
        self.network.load(Ordering::SeqCst)
    }
    pub fn filesystem_open(&self) -> bool {
        self.filesystem.load(Ordering::SeqCst)
    }
}

/// Webview → shell: push the current gate state. Called whenever the user
/// toggles a gate so the Rust enforcement stays in sync with the UI.
#[tauri::command]
pub fn set_gates(filesystem: bool, network: bool, tools: bool, gates: State<GateState>) {
    gates.filesystem.store(filesystem, Ordering::SeqCst);
    gates.network.store(network, Ordering::SeqCst);
    gates.tools.store(tools, Ordering::SeqCst);
}

#[derive(Clone)]
pub struct SidecarManager {
    info: Arc<Mutex<SidecarInfo>>,
    child: Arc<Mutex<Option<Child>>>,
    shutting_down: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self {
            info: Arc::new(Mutex::new(SidecarInfo::default())),
            child: Arc::new(Mutex::new(None)),
            shutting_down: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}

fn script_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("sidecar/agent_sidecar.py");
        if p.exists() {
            return Some(p);
        }
    }
    // dev fallback: <project>/sidecar/agent_sidecar.py
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/agent_sidecar.py");
    if dev.exists() {
        return Some(dev);
    }
    None
}

fn python_candidates() -> &'static [&'static str] {
    if cfg!(windows) {
        &["python", "py", "python3"]
    } else {
        &["python3", "python"]
    }
}

impl SidecarManager {
    fn set_status(&self, s: &str) {
        self.info.lock().unwrap().status = s.to_string();
    }

    pub fn start(&self, app: &AppHandle) {
        self.shutting_down.store(false, Ordering::SeqCst);
        self.set_status("starting");

        let path = match script_path(app) {
            Some(p) => p,
            None => {
                self.set_status("error");
                eprintln!("[sidecar] agent_sidecar.py not found");
                return;
            }
        };

        let mut child = None;
        for exe in python_candidates() {
            match Command::new(exe)
                .arg(&path)
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(c) => {
                    child = Some(c);
                    break;
                }
                Err(_) => continue,
            }
        }
        let mut child = match child {
            Some(c) => c,
            None => {
                self.set_status("error");
                eprintln!("[sidecar] no python interpreter found");
                return;
            }
        };

        // Read the handshake (and watch for EOF = process exit) on a thread so
        // setup never blocks.
        if let Some(out) = child.stdout.take() {
            let info = self.info.clone();
            let shutting = self.shutting_down.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(out);
                let mut first = String::new();
                if reader.read_line(&mut first).unwrap_or(0) > 0 {
                    if let Ok(hs) = serde_json::from_str::<Handshake>(first.trim()) {
                        let mut i = info.lock().unwrap();
                        i.host = hs.host;
                        i.port = hs.port;
                        i.token = hs.token;
                        i.status = "ready".to_string();
                    }
                }
                // Drain until EOF; EOF means the child exited.
                let mut line = String::new();
                while reader.read_line(&mut line).unwrap_or(0) > 0 {
                    line.clear();
                }
                if !shutting.load(Ordering::SeqCst) {
                    info.lock().unwrap().status = "error".to_string();
                }
            });
        }

        *self.child.lock().unwrap() = Some(child);
    }

    pub fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
        if let Some(mut c) = self.child.lock().unwrap().take() {
            let _ = c.kill();
        }
        let mut i = self.info.lock().unwrap();
        i.status = "stopped".to_string();
        i.port = 0;
        i.token.clear();
    }

    pub fn snapshot(&self) -> SidecarInfo {
        self.info.lock().unwrap().clone()
    }

    /// Ask any in-flight stream to stop (STOP button). The stream loop checks
    /// this between chunks and ends cleanly.
    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }
}

fn sanitize_error(error: impl ToString) -> String {
    redact_secrets(&error.to_string())
}

fn validate_sidecar_command_message(message: &str) -> Result<(), String> {
    validate_sidecar_message(message).map_err(sanitize_error)
}

#[tauri::command]
pub fn sidecar_info(mgr: State<SidecarManager>) -> SidecarInfo {
    mgr.snapshot()
}

#[tauri::command]
pub fn sidecar_restart(app: AppHandle, mgr: State<SidecarManager>) -> SidecarInfo {
    mgr.shutdown();
    mgr.start(&app);
    mgr.snapshot()
}

/// Webview → shell: cancel the in-flight stream (STOP button).
#[tauri::command]
pub fn sidecar_cancel(mgr: State<SidecarManager>) {
    mgr.request_cancel();
}

/// Confirm the process on the handshake port is really our A2A agent by reading
/// its agent card and checking the protocol version (Phase 1.5).
async fn verify_agent_card(client: &reqwest::Client, host: &str, port: u16) -> Result<(), String> {
    let url = format!("http://{}:{}/.well-known/agent-card.json", host, port);
    let resp = client.get(&url).send().await.map_err(sanitize_error)?;
    if !resp.status().is_success() {
        return Err(format!("agent card HTTP {}", resp.status().as_u16()));
    }
    let card: serde_json::Value = resp.json().await.map_err(sanitize_error)?;
    let proto = card
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !proto.starts_with("0.3") {
        return Err(format!("unexpected sidecar agent (protocol '{}')", proto));
    }
    Ok(())
}

/// Send a chat to the sidecar over loopback A2A and return the reply text.
/// The bearer token is read from managed state and stays inside Rust — the
/// webview only ever passes the message string (Phase 1 security spine).
#[tauri::command]
pub async fn sidecar_send(
    message: String,
    mgr: State<'_, SidecarManager>,
    gates: State<'_, GateState>,
) -> Result<String, String> {
    // Hard gate: the agent bridge is governed by the Tools gate at the process
    // level — not just in the UI (Phase 1.3).
    if !gates.tools_open() {
        return Err("tools gate closed".to_string());
    }
    validate_sidecar_command_message(&message)?;
    let info = mgr.snapshot();
    if info.status != "ready" {
        return Err("sidecar not ready".to_string());
    }
    let url = format!("http://{}:{}/a2a", info.host, info.port);
    let mid = format!(
        "m-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "message/send",
        "params": {
            "message": {
                "kind": "message",
                "role": "user",
                "messageId": mid,
                "parts": [{ "kind": "text", "text": message }]
            }
        }
    });

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(sanitize_error)?;
    verify_agent_card(&client, &info.host, info.port).await?;
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", info.token))
        .json(&payload)
        .send()
        .await
        .map_err(sanitize_error)?;
    if !resp.status().is_success() {
        return Err(format!("A2A HTTP {}", resp.status().as_u16()));
    }
    let v: serde_json::Value = resp.json().await.map_err(sanitize_error)?;
    let text = v
        .get("result")
        .and_then(|r| r.get("parts"))
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<String>()
        })
        .unwrap_or_default();
    Ok(text)
}

/// Stream a chat reply from the sidecar, pushing each text chunk to the webview
/// through a Tauri Channel as it arrives. The bearer token stays inside Rust
/// (Phase 1). Returns when the stream completes.
#[tauri::command]
pub async fn sidecar_stream(
    message: String,
    on_event: tauri::ipc::Channel<String>,
    mgr: State<'_, SidecarManager>,
    gates: State<'_, GateState>,
) -> Result<(), String> {
    // Hard gate: closing the Tools gate severs the agent bridge in Rust (1.3).
    if !gates.tools_open() {
        return Err("tools gate closed".to_string());
    }
    validate_sidecar_command_message(&message)?;
    let info = mgr.snapshot();
    if info.status != "ready" {
        return Err("sidecar not ready".to_string());
    }
    let url = format!("http://{}:{}/a2a", info.host, info.port);
    let mid = format!(
        "m-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "message/stream",
        "params": {
            "message": {
                "kind": "message",
                "role": "user",
                "messageId": mid,
                "parts": [{ "kind": "text", "text": message }]
            }
        }
    });

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(sanitize_error)?;
    verify_agent_card(&client, &info.host, info.port).await?;
    mgr.cancel.store(false, Ordering::SeqCst);
    let mut resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", info.token))
        .json(&payload)
        .send()
        .await
        .map_err(sanitize_error)?;
    if !resp.status().is_success() {
        return Err(format!("A2A HTTP {}", resp.status().as_u16()));
    }

    // Read the SSE body incrementally and forward each message event's text.
    let mut buf = String::new();
    while let Some(chunk) = resp.chunk().await.map_err(sanitize_error)? {
        if mgr.cancel.load(Ordering::SeqCst) {
            break; // STOP pressed — end the stream cleanly
        }
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buf.find("\n\n") {
            let frame = buf[..idx].trim().to_string();
            buf = buf[idx + 2..].to_string();
            let data = match frame.strip_prefix("data:") {
                Some(d) => d.trim(),
                None => continue,
            };
            let ev: serde_json::Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let is_message = ev
                .get("result")
                .and_then(|r| r.get("kind"))
                .and_then(|k| k.as_str())
                == Some("message");
            if !is_message {
                continue;
            }
            let text: String = ev
                .get("result")
                .and_then(|r| r.get("parts"))
                .and_then(|p| p.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                        .collect()
                })
                .unwrap_or_default();
            if !text.is_empty() {
                on_event.send(text).map_err(sanitize_error)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_never_serialized_to_the_webview() {
        // Phase 1.1 guarantee: the bearer token stays in the shell. Serializing
        // the info that goes to the webview must not include it.
        let info = SidecarInfo {
            status: "ready".into(),
            host: "127.0.0.1".into(),
            port: 1234,
            token: "SUPER-SECRET-TOKEN".into(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(
            !json.contains("SUPER-SECRET-TOKEN"),
            "bearer token value leaked into serialized info: {json}"
        );
        assert!(
            !json.contains("token"),
            "token field present in serialized info: {json}"
        );
    }

    #[test]
    fn gates_default_open_then_closing_tools_reads_severed() {
        // Phase 1.3 guarantee: the Rust-held gate state is the enforcement point.
        let g = GateState::default();
        assert!(g.tools_open() && g.network_open() && g.filesystem_open());
        g.tools.store(false, Ordering::SeqCst);
        assert!(
            !g.tools_open(),
            "a closed tools gate must read as closed (bridge severed)"
        );
        assert!(
            g.network_open(),
            "closing tools must not affect other gates"
        );
    }

    #[test]
    fn sidecar_command_validation_rejects_oversized_message_without_echoing_content() {
        let message = "x".repeat(crate::validation::MAX_MESSAGE_TEXT_LENGTH + 1);
        let err = validate_sidecar_command_message(&message).unwrap_err();
        assert!(err.contains("too long"));
        assert!(!err.contains('x'));
    }

    #[test]
    fn sidecar_command_validation_rejects_blank_message() {
        assert!(validate_sidecar_command_message("   ")
            .unwrap_err()
            .contains("required"));
    }
}
