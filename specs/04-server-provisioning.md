# 04 — Server provisioning

## Goal

The user creates a Hetzner or Contabo server from the dashboard in a few clicks and watches it come online.

## User value

No provider console, no SSH keys, no copy-pasting cloud-init. Pick a size and click **Create server**.

## Scope

- **Provider credentials** (Settings → Providers):
  - Hetzner: one API token. Contabo: client ID, client secret, API user, API password.
  - Validated on save with a cheap read call; a green "Connected" or a precise error.
  - Stored encrypted in D1 (AES-GCM, key in a Worker secret created at install). Never returned to the UI after saving; only "Connected · added 3 Oct".
- **Create server** form: provider, location, size (a short curated list with price per month, a recommended default), name, and coding agents to install (checkboxes: Claude Code, Codex, OpenCode; Claude Code preselected; at least one). Ubuntu 24.04 LTS only.
- Provisioning call injects the cloud-init bootstrap from 05 with a one-time enrollment token.
- **Server page**: status, provider, IP, size, location, created date, agent version, last heartbeat.
- **Progress view**: Creating at provider → Booting → Installing → Online, driven by provider status plus installer progress reported by the agent (05). The flat "creating" mascot illustration while waiting.
- **Delete server**: typed-name confirmation; deletes at the provider, removes it from D1.
- **Add existing server**: show a one-line `curl … | sh` with an enrollment token for any Ubuntu 24.04 machine (covers other providers for free).

## Provider notes

- Hetzner: hourly billing, fast (about 1 minute), `user_data` supported. The default provider.
- Contabo: monthly billing, slow provisioning (can take 10+ minutes), `userData` supported, deletion means cancellation. The UI says so before creating.

## Out of scope

OVHcloud and other providers (use "Add existing server"), resizing, snapshots, firewalls beyond the provider default, multiple servers per click.

## UX states

- No provider connected: the empty state leads straight to "Connect Hetzner".
- Provider rejects the request (quota, invalid location): show the provider's message plus what to change.
- Stuck at Installing for more than 15 minutes: show the last installer log lines and a "Delete and retry" action.

## Acceptance

- Hetzner: click to "Online" in under 5 minutes.
- Contabo: a server reaches "Online" and the UI was honest about the wait and the billing.
- A credential never appears in any API response, log line or D1 column in plain text.
- Deleting removes the server at the provider (verified via the provider API).
