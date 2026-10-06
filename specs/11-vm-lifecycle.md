# 11 — VM lifecycle (later)

## Goal

Servers stay up to date and recoverable without the user becoming a sysadmin. Deliberately last: decide details once real servers run.

## User value

Updates happen safely, and losing a server never means losing the work.

## Candidate scope (pick the smallest useful set when we get here)

- **Agent self-update**: the control plane advertises the current agent version; the server page shows "Update available" and a button. The agent downloads, verifies the checksum, replaces itself and restarts. Terminals survive because they live in tmux.
- **Installer versioning**: `install.sh` carries a version; the server page shows it; rerunning the newest installer is the upgrade path for system packages.
- **OS and Docker updates**: unattended-upgrades for security patches (already on from 05); Docker upgrades through apt with the rest. No extra machinery.
- **Rebuild**: delete the server and create it again with the same name; projects are restored from a backup.
- **Backups**: provider snapshots (Hetzner backups toggle) as the zero-effort option; optionally `restic` of `/projects` to S3-compatible storage the user owns.
- **Secrets**: project environment variables and app secrets live in project `.env` files on the VM (not D1). Revisit only if users ask for a UI.
- **Disaster recovery for the control plane**: D1 holds only rebuildable metadata, so recovery is "reinstall, reconnect provider, re-enroll servers with the curl one-liner". Document it.

## Out of scope

Fleet management, rolling updates across many servers, custom images, configuration management tools.

## Acceptance (once scoped)

- An agent update from the UI completes without dropping a running Claude Code session.
- A documented restore from backup to a new server works end to end.
