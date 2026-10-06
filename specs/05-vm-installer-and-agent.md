# 05 — VM installer and daemons-agent

## Goal

A vanilla Ubuntu VM turns into a daemons server and keeps a secure outbound connection to the control plane.

## User value

The server is ready for real work (Docker, Git, coding agents) with no manual setup, and needs no open management ports.

## Bootstrap chain

```
cloud-init (tiny, token in a root-only file) → curl https://<control-plane>/install.sh | sh → install.sh → daemons-agent (systemd)
```

## Installer (`install.sh`)

- Idempotent POSIX shell. Rerunning it is the repair path.
- Installs: Docker Engine + Compose plugin (official apt repo), git, GitHub CLI (`gh`), curl, build-essential, tmux, ufw, unattended-upgrades.
- Creates user `dev` (sudo, docker group), `/projects` owned by `dev`. Not `daemon`: Ubuntu already ships a system account of that name (uid 1, used by atd); owner decision 2026-10-06.
- Installs the coding agents chosen at server creation (any of Claude Code, Codex, OpenCode), for user `dev`, using each vendor's official install method (Node.js LTS when one needs it). Only installed; the user signs in themselves in the terminal (06). Adding one later: rerun the installer with another agent selected on the server page.
- Downloads the `daemons-agent` binary for the VM architecture (amd64 and arm64) from the GitHub release named by the installer version, verifies it against the release's `SHA256SUMS`, installs the systemd unit, enrolls, starts it (release process: 12).
- Reports progress steps to the control plane, shown in the 04 progress view.
- **Host firewall**: `ufw` default deny incoming, allow SSH (IPv4 and IPv6). Docker bypasses ufw for published ports, so the installer sets `"ip": "127.0.0.1"` in `/etc/docker/daemon.json`: `ports: ["3306:3306"]` in a Compose file binds to loopback unless the user explicitly writes `0.0.0.0:`. Apps are reached through 08, not open ports.
- The enrollment token never appears in a URL, command line or log; the installer reads it from the root-only file and deletes it after enrollment.
- Progress and errors are posted to `/agent/progress` with the enrollment token from the first step on, so failures before the agent runs are still visible in the UI.
- Leaves SSH as the provider set it up.

## Enrollment

- The one-time enrollment token (valid 1 hour) is exchanged at `/agent/enroll` for a long-lived agent credential (random 256-bit secret, stored hashed in D1, plaintext in `/etc/daemons/agent.toml` with mode 600).
- The credential can be revoked from the server page (Disconnect).

## daemons-agent

- Go, single binary, runs as root (it needs PTYs for `dev` and service discovery), started by systemd.
- Opens one WebSocket to `wss://<control-plane>/agent/connect`, which lands in that server's Durable Object. Reconnects with backoff, forever.
- Protocol: JSON messages `{id, type, ...}` with replies `{id, ok, ...}`; terminal data as binary frames tagged with a channel id. Messages in v1:
  - `register` (protocol version, agent version, hostname, OS, arch, CPU, RAM, disk), `heartbeat` (every 30 s, liveness only); details such as load, disk and listening ports are fetched on demand when a page needs them
  - `exec` (command, cwd → exit code, stdout, stderr; capped size and time)
  - `terminal.open/input/resize/close` (06)
  - `file.list/read/write/delete/mkdir` (09)
  - `app.expose/unexpose` + `http.request/response` (08)
- **Wire contract first.** The first slice writes `agent/PROTOCOL.md`: protocol version, message and channel framing, request deadlines, bounded queues per channel, cancellation, which side owns reconnects, and tmux attach versus kill semantics. Control plane and agent are both built against it.
- **Durable Object rules** (from Cloudflare's free plan and hibernation model): SQLite-backed class (`new_sqlite_classes`), `ctx.acceptWebSocket` for agent and browser sockets, socket role and channel ids stored in socket attachments so they survive hibernation, no long-running timers in the DO (the agent sends heartbeats; the DO only answers).
- Also ships the `daemons` CLI (`daemons status`, `daemons expose`, `daemons apps`), which talks to the local agent over a Unix socket.
- If the control plane is down, the agent only retries. Nothing on the VM stops.

## Out of scope

Agent self-update (11), metrics history, log shipping, custom images.

## UX states

- Server page shows Online / Offline (no heartbeat for 90 s) / Installing, with "last seen 2 min ago".
- Installer failure: the failing step and its last 50 log lines appear on the server page.

## Acceptance

- Fresh Hetzner Ubuntu 24.04: from boot to Online without any manual step.
- `ss -tlnp` on the VM shows no listener added by daemons.
- Kill the control plane (or block it): Docker containers, tmux sessions and running agents continue; the agent reconnects by itself when it is back.
- Rerunning `install.sh` on a healthy server changes nothing and stays Online.
- Durable Object usage for one idle server stays in the free tier (hibernating WebSocket).
