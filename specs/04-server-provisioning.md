# 04 — Server provisioning

## Goal

The user creates a Hetzner or Contabo server from the dashboard in a few clicks and watches it come online.

## User value

No provider console, no SSH keys, no copy-pasting cloud-init. Pick a size and click **Create server**.

## UI reference

Reuse from the old project: [ui-reference.md](ui-reference.md), sections "Server provisioning".

## Scope

- **Provider credentials** (Settings → Providers):
  - Hetzner: one API token. Contabo: client ID, client secret, API user, API password.
  - Validated on save with a cheap read call; a green "Connected" or a precise error.
  - Stored encrypted in D1: AES-GCM with a random 96-bit nonce per value and a key id stored next to the ciphertext. The key is generated on first use and kept in a dedicated Durable Object's storage, never in D1. If the key is ever lost, the UI asks the user to re-enter provider credentials; nothing else depends on it.
  - Never returned to the UI after saving; only "Connected · added 3 Oct".
- **Create server** form: provider, location, size (a short curated list with price per month, a recommended default), name, and coding agents to install (checkboxes: Claude Code, Codex, OpenCode; Claude Code preselected; at least one). Ubuntu 24.04 LTS only.
- **Durable creation.** The server row (status `creating`, chosen options, enrollment token hash) is written to D1 before the provider call, and the provider ID right after. If the provider call times out, the control plane looks the server up by name at the provider before showing an error, and never buys a second VM by itself. Status is reconciled from the provider API whenever the server page or list is open, so closing the browser changes nothing.
- Provisioning call injects the cloud-init bootstrap from 05 with a one-time enrollment token.
- **Server page**: status, provider, IP, size, location, created date, agent version, last heartbeat.
- **Progress view**: Creating at provider → Booting → Installing → Online, driven by provider status plus installer progress reported by the agent (05). The flat "creating" mascot illustration while waiting.
- **Delete server**: typed-name confirmation. Hetzner: deletes at the provider, removes it from D1. Contabo: see below.
- **Add existing server**: show a one-line `curl … | sh` with an enrollment token for any Ubuntu 24.04 machine (covers other providers for free).

## Provider notes

- Hetzner: hourly billing, fast (about 1 minute), `user_data` supported. The default provider.
- Contabo (owner, 2026-10-06: keep it, with an honest UI): monthly billing, slow provisioning (can take 10+ minutes), `userData` supported. Before creating, the UI says "Billed monthly; cancelling keeps it running until the end of the period". **Delete becomes Cancel subscription**: the server stays listed as "Cancelled, runs until 31 Oct" and disappears from the list when Contabo removes it.

## Out of scope

OVHcloud and other providers (use "Add existing server"), resizing, snapshots, provider-level firewalls (the host firewall is set by the installer, 05), multiple servers per click.

## UX states

- No provider connected: the empty state leads straight to "Connect Hetzner".
- Provider rejects the request (quota, invalid location): show the provider's message plus what to change.
- Stuck at Installing for more than 15 minutes: show the last installer log lines (sent with the enrollment token to `/agent/progress`) and **Retry install** (reruns the installer through the provider's rebuild with the same user data on Hetzner, or the curl one-liner over the provider console). For Contabo, never suggest buying another server without saying it costs another month.

## Acceptance

- Hetzner: click to "Online" in under 5 minutes.
- Contabo: a server reaches "Online" and the UI was honest about the wait and the billing.
- A credential never appears in any API response, log line or D1 column in plain text.
- Deleting a Hetzner server removes it at the provider (verified via the provider API); cancelling a Contabo server shows the end date the provider reports.
- Closing the browser during creation does not lose or duplicate a server.
