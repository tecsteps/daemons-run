# daemons-agent wire protocol (version 1)

The working user on the VM is `dev` (Ubuntu already has a system account `daemon`; owner decision 2026-10-06).

The contract between `daemons-agent` on a VM and the control plane Worker. Both sides are built
against this file; change it first, then the code.

## Endpoints (HTTPS, on the control plane origin)

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /install.sh` | none | The installer, pinned to the control plane's agent release. |
| `POST /agent/progress` | `Authorization: Bearer <enrollment token>` | Installer progress. Body `{"step": "docker", "status": "running"\|"done"\|"failed", "log": "last lines"}`. Reply `204`. Works until the token is consumed, plus 1 hour after for failures. |
| `POST /agent/enroll` | `Authorization: Bearer <enrollment token>` | Body: the `register` facts below. Reply `200 {"server_id", "name", "credential"}`. Consumes the token (single use, valid 1 hour). |
| `GET /agent/connect` (WebSocket upgrade) | `Authorization: Bearer <agent credential>`, `X-Daemons-Protocol: 1` | The one long-lived connection. `401` = credential revoked: the agent stops retrying until the config changes or it is restarted. `426` = protocol version not supported. |

Tokens and credentials are 32 random bytes, base64url without padding. The control plane only
stores SHA-256 hashes. The enrollment token comes from `/etc/daemons/enroll-token` (mode 600) and
is deleted after enrollment. The agent writes `/etc/daemons/agent.toml` (mode 600):

```toml
control_plane = "https://daemons.example.workers.dev"
server_id = "srv_..."
credential = "..."
```

## Frames

- **Text frames** carry one JSON object each, UTF-8, at most 1 MiB.
- **Text frame `ping`** (the literal 4 bytes, not JSON) is the heartbeat. The agent sends it every
  30 s; the control plane answers `pong` without waking up (Durable Object auto-response). If no
  `pong` arrives for 75 s the agent closes the socket and reconnects.
- **Binary frames** carry channel data:

  ```
  byte 0      kind
  bytes 1..4  channel id, uint32 big endian
  bytes 5..   payload (at most 64 KiB; a proxied WebSocket message, kinds 0x03/0x04, travels
              whole in one frame and may be up to 1 MiB)
  ```

  | kind | meaning |
  |---|---|
  | `0x01` | terminal bytes (agent → CP: PTY output; CP → agent: keyboard input) |
  | `0x02` | HTTP body bytes (CP → agent: request body; agent → CP: response body) |
  | `0x03` | proxied WebSocket text message |
  | `0x04` | proxied WebSocket binary message |

Channel ids are chosen by the control plane, are unique per connection, and are never reused on
the same connection.

## Requests, replies, events

- Request: `{"id": "<string>", "type": "<type>", ...params}`.
- Reply: `{"id": "<same>", "ok": true, ...result}` or `{"id": "<same>", "ok": false, "error": {"code": "<code>", "message": "<text>"}}`.
- Event (no reply expected): `{"type": "<type>", ...}` without `id`.
- Either side may send requests. The control plane's ids start with `c`, the agent's with `a`.
- **Deadline:** a request without a reply after 30 s fails on the sender's side with `timeout`
  (`exec` uses its own `timeout_ms` + 5 s). Late replies are dropped.
- **Cancellation:** `{"type": "cancel", "id": "<request id>"}` (event; the one event that carries an
  `id`, the id of the request to cancel). The receiver stops the work if it can; it still replies
  (`ok: false`, `code: "cancelled"`) or not at all.
- Unknown `type` → reply `ok: false`, `code: "unsupported"`. Unknown fields are ignored.

Error codes: `bad_request`, `not_found`, `exists`, `conflict`, `forbidden` (permission denied),
`too_large`, `timeout`, `cancelled`, `unsupported`, `unavailable`, `internal`.

## Connection lifecycle

1. The agent connects and immediately sends `register`:

   ```json
   {"id": "a1", "type": "register", "protocol": 1, "agent_version": "0.1.0",
    "hostname": "web-1", "os": "Ubuntu 24.04.1 LTS", "arch": "amd64",
    "cpus": 2, "memory_bytes": 4100000000, "disk_bytes": 40000000000}
   ```

   Reply: `{"id": "a1", "ok": true, "server_id": "srv_...", "name": "web-1"}`. The control plane
   sends no request before it has replied to `register`.
2. **The agent owns reconnects.** On any close or error it reconnects with exponential backoff
   (1 s doubling to 30 s, ±20 % jitter), forever. It resets the backoff after a connection stayed
   up for 60 s. A new connection from the same server replaces the old one (the control plane
   closes the old socket with code `4000`).
3. When the connection drops, **every channel is gone**: the agent detaches all terminal clients
   (tmux sessions keep running), aborts proxied HTTP requests and closes proxied WebSockets. The
   control plane closes its browser sockets for that server with code `4001`; browsers reattach
   when the agent is back.

## Flow control and priority

- Every sender keeps a bounded queue per channel (256 frames). When a terminal's output queue is
  full, the agent stops reading the PTY until it drains (back-pressure, never dropping bytes).
- The receiver also queues at most 256 inbound frames per channel. A channel whose inbound queue
  overflows is closed with an error event (`http.error` code `too_large`, `ws.close` 1009, or
  `terminal.exit`), so senders must respect the windows below.
- The agent's writer always sends pending terminal frames and JSON before HTTP and proxied
  WebSocket frames, so a large download never stalls a terminal.
- HTTP response bodies use a window: the agent may have at most 1 MiB unacknowledged per channel.
  The control plane sends `{"type": "http.ack", "channel": 7, "bytes": 262144}` as the browser
  consumes the body.
- Request bodies use the same window the other way: the agent sends `http.ack` for request body
  bytes it has written to the app, and the control plane keeps at most 1 MiB unacknowledged.

## Messages

### System

| Type | Direction | Params → result |
|---|---|---|
| `register` | agent → CP | see above → `server_id`, `name` |
| `system.info` | CP → agent | → `hostname, os, arch, cpus, memory_bytes, memory_used_bytes, disk_bytes, disk_used_bytes, load1, uptime_s, agent_version, agents: ["claude","codex","opencode"]` (coding agents found on `dev`'s PATH) |
| `exec` | CP → agent | `command` (string, run with `/bin/bash -lc` as `user`), `cwd` (default `/projects`), `user` (`dev` default, or `root`), `timeout_ms` (default 30000, max 120000) → `exit_code, stdout, stderr, truncated` (each stream capped at 1 MiB) |
| `ports.list` | CP → agent | → `ports: [{port, address, process, pid, cwd}]` listening TCP sockets on loopback and any address, IPv4 and IPv6, excluding the agent's own |

### Terminals (06)

Every terminal is a tmux session of user `dev` on the agent's own tmux server
(`tmux -L daemons -f /etc/daemons/tmux.conf`, which the agent writes and re-sources into a running
server when it changed). The design follows the old daemons-run gateway (tag `pre-pivot-2026-09-05`,
`gateway/src/tmux.js`): **tmux owns the scrollback**. The browser shows tmux's screen (tmux uses
the alternate screen, so the browser has no scrollback of its own); scrolling enters tmux copy mode.
Config: status bar off, `escape-time 0`, `history-limit 50000`, `default-terminal xterm-256color`,
`mouse on` (the browser sends mouse wheel reports), `allow-passthrough on`, `terminal-overrides
,*:Tc`, `destroy-unattached off`, `window-size latest`, and these bindings:

- `WheelUpPane`: in copy mode, scroll; else if the session's `@daemons_scroll` is `copy-mode` or
  the pane is not on the alternate screen, enter copy mode (`copy-mode -e`, leaves at the bottom)
  and scroll up; else send page keys to the application (`C-M-b` for OpenCode, `PageUp` otherwise).
- `WheelDownPane`: in copy mode, scroll; on the alternate screen of a `page-keys` session, send
  `C-M-f` (OpenCode) or `PageDown`.
- `PageUp`/`PageDown` (root table): in a `copy-mode` session, page through history; otherwise sent
  to the application.
- Copy-mode tables (`copy-mode`, `copy-mode-vi`): typing (`Any`, Enter, Escape, Tab, arrows,
  Ctrl+letters and the tables' own letter keys) leaves copy mode and passes the key on, so input
  always reaches the application. Mouse and page keys keep scrolling.

Each session has a **harness**, chosen when it is created and stored as tmux user options
`@daemons_harness` and `@daemons_scroll` (bindings are server-global, so they read them):

| harness | `@daemons_scroll` | extra |
|---|---|---|
| `claude` | `copy-mode` | environment `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`, so the transcript lands in tmux history |
| `codex` | `copy-mode` | |
| `opencode` | `page-keys` | wheel sends `C-M-b` / `C-M-f` (OpenCode's transcript page keys) |
| `shell` | `page-keys` | a pane not on the alternate screen scrolls in copy mode |

Environment: `HOME=/home/dev`, `USER=dev`, `SHELL=/bin/bash`, `TERM=xterm-256color`,
`LANG=C.UTF-8`.

| Type | Direction | Params → result |
|---|---|---|
| `terminal.list` | CP → agent | → `sessions: [{name, created (unix s), attached (int), cwd, command}]` |
| `terminal.open` | CP → agent | `channel, session, cwd` (default `/projects`), `cols, rows, command, harness` (both optional, only used when the session is created; `harness` is `claude`, `codex`, `opencode` or `shell`; without it the agent derives it from the command's first word, else `shell`) → `created: bool, harness, scroll` (`copy-mode` or `page-keys`; for an existing session, the harness it was created with, `shell` for sessions without one). Creates the session if missing, then attaches a PTY client to it on `channel`; tmux redraws the screen on attach. |
| `terminal.capture` | CP → agent | `session, lines` (default 2000, max 10000) → `text`: the session's recent history and screen as plain text (`capture-pane -p -J`), at most 512 KiB (the newest part). For the browser's "Select" sheet. |
| `terminal.resize` | CP → agent | `channel, cols, rows` → ok |
| `terminal.close` | CP → agent | `channel` → ok. **Detaches** (kills the attach client); the session keeps running. |
| `terminal.kill` | CP → agent | `session` → ok. Kills the tmux session and every client attached to it. |
| `terminal.rename` | CP → agent | `session, name` → ok (`exists` if taken) |
| `terminal.exit` | agent → CP (event) | `channel, session, session_ended` (bool) — the attach client ended on its own: the session ended (shell exited or killed, `session_ended: true`) or the client was detached from inside tmux (`false`). The channel is gone either way. |

Session names: `[A-Za-z0-9_-]{1,32}`.

### Files (09)

All as user `dev`. Paths are absolute. Text and binary content travels as base64.

| Type | Params → result |
|---|---|
| `file.list` | `path, hidden` → `entries: [{name, type: "file"\|"dir"\|"link", size, mtime_ms, mode}]` (folders first; `mode` is the permission bits as an integer, e.g. 420 for 0644) |
| `file.stat` | `path` → `{type, size, mtime_ms, mode}` |
| `file.read` | `path, offset` (default 0), `length` (default and max 524288) → `data` (base64), `size, mtime_ms, eof` |
| `file.write` | `path, data` (base64), `offset` (default 0), `truncate` (bool, true for the first chunk), `expected_mtime_ms` (optional; `conflict` if the file changed) → `size, mtime_ms` |
| `file.delete` | `path, recursive` → ok |
| `file.mkdir` | `path` → ok (parents created) |
| `file.rename` | `from, to` → ok (`exists` if `to` exists) |
| `file.archive` | `path, channel` → starts streaming a `.tar.gz` of the folder as kind `0x02` frames on `channel`, ends with event `http.end` or `http.error` (same window rules as HTTP) |

### Apps (08)

Exposed apps live in the control plane (D1). The agent keeps no app state except what the CLI
asks for.

| Type | Direction | Params → result |
|---|---|---|
| `app.expose` | agent → CP | `name, port, cwd, public` → `url, public` (`exists` if the name belongs to another server or port) |
| `app.unexpose` | agent → CP | `name` → ok |
| `app.list` | agent → CP | → `apps: [{name, port, url, public}]` for this server |
| `http.request` | CP → agent | `channel, port, method, path` (with query), `headers` (`[[name, value], ...]`), `body: bool` → ok once the agent accepted the channel. If `body` is true, kind `0x02` frames follow on the channel, then the event `{"type": "http.body.end", "channel"}`. The agent calls `http://127.0.0.1:<port><path>` (falls back to `[::1]`). |
| `http.response` | agent → CP (event) | `channel, status, headers` — then kind `0x02` frames, then `http.end` |
| `http.end` | agent → CP (event) | `channel` |
| `http.error` | agent → CP (event) | `channel, code` (`not_listening` when the connection is refused, `unavailable` for other upstream failures, `too_large`), `message` |
| `http.ack` | both (event) | `channel, bytes` (see "Flow control") |
| `http.cancel` | CP → agent (event) | `channel` — the browser went away |
| `ws.open` | CP → agent | `channel, port, path, headers, protocols` → `protocol` (selected subprotocol), or `unavailable` when nothing listens. Then kind `0x03`/`0x04` frames both ways, one message per frame. |
| `ws.close` | both (event) | `channel, code, reason` |

The control plane adds `X-Forwarded-Prefix: /<name>`, `X-Forwarded-Host`, `X-Forwarded-Proto:
https` and strips the gateway cookie `__daemons_app` before sending `http.request`; the agent
sends headers as given, except `Host`, which it sets to `127.0.0.1:<port>`. The control plane
rewrites `Location` headers pointing at `localhost`/`127.0.0.1:<port>` to the public URL.

## Local CLI socket

The `daemons` CLI talks to the agent over `/run/daemons/agent.sock` (owner root, group `dev`,
mode 660): one JSON request line, one JSON reply line.

| CLI | Request line | Reply |
|---|---|---|
| `daemons status` | `{"cmd": "status"}` | `{"ok": true, "connected": bool, "control_plane", "server_id", "name", "agent_version", "since"}` |
| `daemons expose <port> [--name n] [--public]` | `{"cmd": "expose", "port", "name", "cwd", "public"}` | `{"ok": true, "url", "public"}` or `{"ok": false, "error", "code"}` |
| `daemons unexpose <name>` | `{"cmd": "unexpose", "name"}` | `{"ok": true}` |
| `daemons apps` | `{"cmd": "apps"}` | `{"ok": true, "apps": [...]}` |

Without `--name`, the name is the current directory's basename, lowercased, `[a-z0-9-]` only.
`expose` needs a connected agent and says so otherwise.

## Versioning

`protocol` is an integer. The control plane accepts the versions it knows and answers `426`
otherwise. Additive changes (new message types, new optional fields) do not bump it.
