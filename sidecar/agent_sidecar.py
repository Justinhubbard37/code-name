#!/usr/bin/env python3
"""
CODE NAME — Agent sidecar (Phase 3).

A local-first, loopback A2A-shaped server. Stdlib-only so it runs with zero pip
installs (honors local-first / offline). Implements the confirmed A2A wire shape
(JSON-RPC 2.0 + SSE, spec 0.3): agent card, message/send, message/stream.

Seams (documented):
  - run_agent(text)  -> swap in a real google-adk Agent here.
  - message envelope -> swap in the official a2a-sdk server here.

Contract (docs/contracts/sidecar.md):
  - binds 127.0.0.1 on an OS-assigned ephemeral port (port 0)
  - mints a per-launch bearer token, required on every /a2a call
  - prints one SidecarHandshake JSON line on stdout at startup
"""
import json
import os
import secrets
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SPEC_VERSION = "0.3"
TOKEN = secrets.token_urlsafe(24)

AGENT_CARD = {
    "name": "CODE NAME Agent",
    "description": "Local-first agent sidecar for the CODE NAME harness.",
    "protocolVersion": "0.3.0",
    "version": "0.1.0",
    "url": "",  # filled with the real bound URL at startup
    "skills": [{"id": "chat", "name": "Chat", "description": "Converse / reason", "tags": ["chat"]}],
    "capabilities": {"streaming": True, "pushNotifications": False},
    "defaultInputModes": ["text"],
    "defaultOutputModes": ["text"],
}


def run_agent(text: str) -> str:
    """Pluggable agent logic. SEAM: replace with a google-adk Agent (Phase 3+).

    Example (later):
        from google.adk import Agent
        agent = Agent(name="analyst", model="<local-or-cloud>", instruction="...")
        return agent.run(text)
    """
    try:
        import google.adk  # noqa: F401  (presence check only)
        adk_available = True
    except Exception:
        adk_available = False
    tag = "ADK" if adk_available else "STUB"
    return (
        f"[SIDECAR:{tag}] Received over A2A on loopback. "
        f"Echoing prompt for the Phase 3 round-trip: {text!r}"
    )


def _text_message(text: str, context_id: str) -> dict:
    return {
        "kind": "message",
        "messageId": uuid.uuid4().hex,
        "role": "agent",
        "parts": [{"kind": "text", "text": text}],
        "contextId": context_id,
    }


def _extract_text(params: dict) -> str:
    msg = (params or {}).get("message", {})
    parts = msg.get("parts", []) or []
    return " ".join(p.get("text", "") for p in parts if p.get("kind") == "text").strip()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # silence default logging
        return

    def _json(self, code: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self) -> bool:
        return self.headers.get("Authorization", "") == f"Bearer {TOKEN}"

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "ts": time.time()})
        if self.path == "/.well-known/agent-card.json":
            return self._json(200, AGENT_CARD)
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/a2a":
            return self._json(404, {"error": "not found"})
        if not self._authed():
            return self._json(401, {"error": "unauthorized"})
        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            req = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._json(400, {"error": "bad json"})

        method = req.get("method")
        rid = req.get("id")
        params = req.get("params", {})
        text = _extract_text(params)
        context_id = (params.get("message", {}) or {}).get("contextId") or uuid.uuid4().hex

        if method == "message/send":
            result = _text_message(run_agent(text), context_id)
            return self._json(200, {"jsonrpc": "2.0", "id": rid, "result": result})

        if method == "message/stream":
            return self._stream(rid, text, context_id)

        return self._json(200, {"jsonrpc": "2.0", "id": rid,
                                "error": {"code": -32601, "message": "method not found"}})

    def _stream(self, rid, text: str, context_id: str):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        # The SSE body has no Content-Length, so we close the connection when the
        # stream ends. That gives the client a clean EOF instead of hanging while
        # it waits for more bytes (Phase 1.2 — streaming through the Rust shell).
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        reply = run_agent(text)

        def send(obj):
            self.wfile.write(f"data: {json.dumps(obj)}\n\n".encode())
            self.wfile.flush()

        # Stream the reply word-by-word as A2A message events (0.3-shaped).
        words = reply.split(" ")
        for i, w in enumerate(words):
            chunk = w if i == 0 else " " + w
            send({"jsonrpc": "2.0", "id": rid,
                  "result": {"kind": "message", "messageId": uuid.uuid4().hex,
                             "role": "agent", "contextId": context_id,
                             "parts": [{"kind": "text", "text": chunk}]}})
            time.sleep(0.01)
        send({"jsonrpc": "2.0", "id": rid,
              "result": {"kind": "status-update", "contextId": context_id,
                         "status": {"state": "completed"}, "final": True}})


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    AGENT_CARD["url"] = f"http://127.0.0.1:{port}/a2a"
    handshake = {
        "ready": True,
        "host": "127.0.0.1",
        "port": port,
        "token": TOKEN,
        "protocol": "a2a",
        "specVersion": SPEC_VERSION,
        "pid": os.getpid(),
    }
    sys.stdout.write(json.dumps(handshake) + "\n")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
