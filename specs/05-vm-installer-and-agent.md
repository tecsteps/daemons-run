# 05 — VM installer and daemons-agent

## Goal

A vanilla Ubuntu VM turns into a daemons server and keeps a secure outbound connection to the control plane.

## User value

The server is ready for real work (Docker, Git, coding agents) with no manual setup, and needs no open management ports.

## Bootstrap chain

```
cloud-init (tiny) → curl https://<control-plane>/install.sh?token=… | sh → install.sh → daemons-agent (systemd)
```

## Installer (`install.sh`)

- Idempotent POSIX shell. Rerunning it is the repair path.
- Installs: Docker Engine + Compose plugin (official apt repo), git, curl, build-essential, tmux, unattended-upgrades.
- Creates user `daemon` (sudo, docker group), `/projects` owned by `daemon`.
- Installs the coding agents chosen at server creation (any of Claude Code, Codex, OpenCode), for user `daemon`, using each vendor's official install method (Node.js LTS when one needs it). Only installed; the user signs in themselves in the terminal (06). Adding one later: rerun the installer with another agent selected on the server page.
- Downloads the `daemons-agent` binary (pinned version, checksum verified), installs the systemd unit, enrolls, starts it.
- Reports progress steps to the control plane, shown in the 04 progress view.
- Leaves SSH as the provider set it up; no inbound ports opened by us.

## Enrollment

- The one-time enrollment token (valid 1 hour) is exchanged at `/agent/enroll` for a long-lived agent credential (random 256-bit secret, stored hashed in D1, plaintext in `/etc/daemons/agent.toml` with mode 600).
- The credential can be revoked from the server page (Disconnect).

## daemons-agent

- Go, single binary, runs as root (it needs PTYs for `daemon` and service discovery), started by systemd.
- Opens one WebSocket to `wss://<control-plane>/agent/connect`, which lands in that server's Durable Object. Reconnects with backoff, forever.
- Protocol: JSON messages `{id, type, ...}` with replies `{id, ok, ...}`; terminal data as binary frames tagged with a channel id. Messages in v1:
  - `register` (version, hostname, OS, CPU, RAM, disk), `heartbeat` (every 30 s: load, memory, disk, listening ports)
  - `exec` (command, cwd → exit code, stdout, stderr; capped size and time)
  - `terminal.open/input/resize/close` (06)
  - `file.list/read/write/delete/mkdir` (09)
  - `app.expose/unexpose` + `http.request/response` (08)
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
