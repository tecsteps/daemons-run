# 04 — Server provisioning

## Goal

The user creates a Hetzner server from the dashboard in a few clicks and watches it come online.

## User value

No provider console, no SSH keys, no copy-pasting cloud-init. Pick a size and click **Create server**.

## UI reference

Reuse from the old project: [ui-reference.md](ui-reference.md), sections "Server provisioning".

## Scope

- **Provider credentials** (Settings → Providers):
  - Hetzner: one API token.
  - Validated on save with a cheap read call; a green "Connected" or a precise error.
  - Stored encrypted in D1: AES-GCM with a random 96-bit nonce per value and a key id stored next to the ciphertext. The key is generated on first use and kept in a dedicated Durable Object's storage, never in D1. If the key is ever lost, the UI asks the user to re-enter provider credentials; nothing else depends on it.
  - Never returned to the UI after saving; only "Connected · added 3 Oct".
- **SSH key (optional)** in Settings: a public key passed to Hetzner on create. Hetzner emails a root password when no key is given, so without a key the installer disables SSH password login and the UI says "No SSH key: access the server through the browser terminal".
- **Create server** form: provider, location, server type (the full grouped list below), name, and coding agents to install (checkboxes: Claude Code, Codex, OpenCode; Claude Code preselected; at least one). Ubuntu 24.04 LTS only.
- **Durable creation.** The server row (status `creating`, chosen options, enrollment token hash) is written to D1 before the provider call, and the provider ID right after. If the provider call times out, the control plane looks the server up by name at the provider before showing an error, and never buys a second VM by itself. Status is reconciled from the provider API whenever the server page or list is open, so closing the browser changes nothing.
- Provisioning call injects the cloud-init bootstrap from 05 with a one-time enrollment token.
- **Server page**: status, provider, IP, size, location, created date, agent version, last heartbeat.
- **Progress view**: Creating at provider → Booting → Installing → Online, driven by provider status plus installer progress reported by the agent (05). The flat "creating" mascot illustration while waiting.
- **Delete server**: typed-name confirmation; deletes at Hetzner, removes it from D1. An added existing server is only disconnected, never deleted.
- **Add existing server**: show a one-line `curl … | sh` with an enrollment token for any Ubuntu 24.04 machine (covers other providers for free).

## No lock-in (owner, 2026-10-06)

Hetzner is the only provider in v1, but nothing outside one folder knows that:

- **One small interface**, `control-plane/src/providers/provider.ts`, with exactly what the UI needs: `validateCredentials`, `listOptions` (locations, sizes with monthly price), `createServer(name, location, size, userData)`, `getServer`, `deleteServer`, `rebuildServer`. Hetzner implements it in `providers/hetzner.ts`. Adding a provider means adding one file and its credential form, nothing else.
- **Generic data.** D1 stores `provider` (a string), `provider_server_id`, an encrypted credentials blob per provider, and the chosen options as plain values. No Hetzner-shaped columns.
- **Provider-neutral VM side.** The bootstrap is standard cloud-init user data plus `curl … | sh`, and the same installer serves **Add existing server**. The agent, installer and protocol never mention a provider.
- **Generic UI.** The create form and server page show provider data through the interface (labels, prices, locations), so a second provider gets the same screens. With one provider connected, the provider picker is hidden.
- Not more than that: no plugin system, no provider registry, no capability flags until a second provider exists.

## Provider notes

- Hetzner: hourly billing, fast (about 1 minute), `user_data` supported. The only provider in v1.
- **Sizes: no recommendation, the full list** (owner, 2026-10-06). The create form lists every current Hetzner server type, read live from the API and grouped like Hetzner's own console: **Cost-Optimized** (shared, older hardware, x86 or Arm64), **Regular Performance** (shared, newer AMD) and **General Purpose** (dedicated vCPUs). Columns: name, vCPUs, architecture, RAM, SSD, traffic, price per hour and per month; sorted by price. Types sold out at the chosen location are shown disabled with "Not available in <location>". Deprecated types are hidden. Both x86 and Arm64 work (05 ships both agent builds).
- Contabo and other providers: deferred (owner, 2026-10-06: start with Hetzner only). Their machines join through **Add existing server**. When Contabo comes back: deletion is a cancellation that runs until the end of the billing period, so the UI must say so (see the Sol review in git history).

## Out of scope

Contabo, OVHcloud and other providers (use "Add existing server"), resizing, snapshots, provider-level firewalls (the host firewall is set by the installer, 05), multiple servers per click.

## UX states

- No provider connected: the empty state leads straight to "Connect Hetzner".
- Provider rejects the request (quota, invalid location): show the provider's message plus what to change.
- Stuck at Installing for more than 15 minutes: show the last installer log lines (sent with the enrollment token to `/agent/progress`) and **Retry install** (rebuilds the Hetzner server with the same user data; for an added existing server, shows the curl one-liner again).

## Acceptance

- Hetzner: click to "Online" in under 5 minutes.
- Add existing server: a non-Hetzner Ubuntu 24.04 machine reaches "Online" with the one-liner.
- A credential never appears in any API response, log line or D1 column in plain text.
- Deleting a Hetzner server removes it at the provider (verified via the provider API).
- Closing the browser during creation does not lose or duplicate a server.
