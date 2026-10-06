# 00 — Overview

daemons.run: provision a normal Linux VM, give it a browser UI, run coding agents on it, expose localhost apps securely. Everything else stays normal Linux, Git, Docker and coding-agent workflows.

MIT licensed. One user per control plane. No central SaaS hosting of user projects.

## The product in one flow

1. User clicks **Install** on daemons.run (or pastes a prompt into their local coding agent).
2. Their own control plane is deployed to `https://daemons.<account>.workers.dev`.
3. They open it, register a passkey.
4. They paste a Hetzner or Contabo API key and click **Create server**.
5. A few minutes later the server is online. They open a terminal, log into Claude Code or Codex, and work in `/projects/<name>`.
6. They run `daemons expose 3000 --name shop` and open `https://daemons-apps.<account>.workers.dev/shop/` from their phone (apps get their own origin, 08).

Every epic exists to make one step of this flow good. If a feature does not serve the flow, it waits.

## Epics

| # | Epic | Delivers |
|---|---|---|
| 01 | [Control plane foundation](01-control-plane-foundation.md) | Worker, D1, dashboard shell with the Terminal Lime look |
| 02 | [Passkey authentication](02-passkey-auth.md) | Passkey-only sign-in, setup link, recovery |
| 03 | [Installation](03-installation.md) | Deploy button and local coding-agent install |
| 04 | [Server provisioning](04-server-provisioning.md) | Hetzner and Contabo servers from the UI |
| 05 | [VM installer and daemons-agent](05-vm-installer-and-agent.md) | cloud-init, installer, agent with an outbound connection |
| 06 | [Browser terminal](06-browser-terminal.md) | Terminal in the browser, coding agents on the VM |
| 07 | [Projects](07-projects.md) | `/projects` as the unit of work |
| 08 | [App exposure](08-app-exposure.md) | `localhost:<port>` at `daemons-apps.<account>.workers.dev/<name>/` |
| 09 | [Files](09-files.md) | Browse, edit, upload, download |
| 10 | [Homepage](10-homepage.md) | daemons.run marketing site with the Install button |
| 11 | [VM lifecycle](11-vm-lifecycle.md) | Upgrades, rebuild, recovery (later) |
| 12 | [Repository and releases](12-repository.md) | README, MIT license, CI, agent release builds |

Order of delivery: 12 (repo basics) → 01 (including a minimal install script) → 02 → 04 + 05 → 06 is the first usable product ("a server with a terminal"). Then 08 (the differentiator; prove the proxy early, ideally alongside 06), 07, 03 (Deploy button and polish), 10. 09 and 11 follow.

## Pieces and where they are specified

| Piece | Epics |
|---|---|
| Repository (README, license, CI, releases) | 12 |
| Homepage daemons.run (look reused from the old project) | 10 |
| Control plane (UI reused from the old project) | 01 shell, 02 auth, 03 install, 08 app gateway; screens in 04, 06, 07, 09 |
| VM provisioning | 04 provider and server UI, 05 cloud-init, installer, agent |
| VM usage | 06 terminal and coding agents, 07 projects, 08 apps, 09 files, 11 lifecycle |
| Old UI to reuse | [ui-reference.md](ui-reference.md) |

## Stack decisions (keep them boring)

| Part | Choice | Why |
|---|---|---|
| Control plane API | TypeScript Worker, Hono | Small, native to Workers |
| Control plane UI | React + Vite, Tailwind v4, served as Workers static assets | Reuses the old look and feel |
| Metadata | D1 | Free tier, SQL |
| VM connections | One Durable Object per server, holding the agent's WebSocket (hibernation API) | Outbound-only from the VM, no inbound ports, free tier |
| daemons-agent | Go (owner, 2026-10-06), one static binary, also provides the `daemons` CLI | Easy download, solid PTY support |
| Installer | One POSIX shell script, versioned, served by the control plane | No Ansible, no images |
| Apps gateway | Second tiny Worker `daemons-apps`, service binding to the control plane | Separate origin for apps (08) |
| Homepage | Static site on Cloudflare (Workers static assets) | Same stack, no server |

## Repository layout

```
control-plane/   Worker, Durable Objects, D1 migrations, UI
apps-gateway/    the daemons-apps Worker (08)
agent/           daemons-agent + daemons CLI (Go)
installer/       cloud-init template + install.sh
website/         daemons.run homepage
specs/           these epics
```

## Design source

Look and feel, mascot images, brand and many UI components come from the old project (`/Users/wesner/Herd/daemons-run`). **[ui-reference.md](ui-reference.md) maps each epic to the exact files to reuse** and lists what not to take. We take the look and small proven components, never the architecture.

## Rules for every epic

- **UX first.** Every epic names the screen states: empty, loading, error, success. No dead ends; every error says what to do next.
- **Smallest thing that works.** No abstraction for a second provider, user or region until it exists.
- **Free tier.** A normal single user stays within Cloudflare's free tier (Durable Objects: 100,000 requests and 13,000 GB-s per day; incoming WebSocket messages count 20:1). Terminal and app traffic are the risk; epics 05, 06 and 08 measure it.
- **The VM keeps working without the control plane.** Nothing on the VM depends on the control plane being up.
- **Mobile works.** Every screen, the terminal included, works on a phone. Check it first with the browser's mobile view, then do the final check in the iOS Simulator (Safari) and the Android emulator (Chrome) on the dev machine.
