# 00 — Overview

daemons.run: provision a normal Linux VM, give it a browser UI, run coding agents on it, expose localhost apps securely. Everything else stays normal Linux, Git, Docker and coding-agent workflows.

MIT licensed. One user per control plane. No central SaaS hosting of user projects.

## The product in one flow

1. User clicks **Install** on daemons.run (or pastes a prompt into their local coding agent).
2. Their own control plane is deployed to `https://daemons.<account>.workers.dev`.
3. They open it, register a passkey.
4. They paste a Hetzner or Contabo API key and click **Create server**.
5. A few minutes later the server is online. They open a terminal, log into Claude Code or Codex, and work in `/projects/<name>`.
6. They run `daemons expose 3000 --name shop` and open `https://daemons.<account>.workers.dev/apps/shop` from their phone.

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
| 08 | [App exposure](08-app-exposure.md) | `localhost:<port>` at `/apps/<name>` |
| 09 | [Files](09-files.md) | Browse, edit, upload, download |
| 10 | [Homepage](10-homepage.md) | daemons.run marketing site with the Install button |
| 11 | [VM lifecycle](11-vm-lifecycle.md) | Upgrades, rebuild, recovery (later) |

Order of delivery: 01 → 02 → 04 → 05 → 06 is the first usable product ("a server with a terminal"). Then 08 (the differentiator), 07, 03, 10. 09 and 11 follow.

## Stack decisions (keep them boring)

| Part | Choice | Why |
|---|---|---|
| Control plane API | TypeScript Worker, Hono | Small, native to Workers |
| Control plane UI | React + Vite, Tailwind v4, served as Workers static assets | Reuses the old look and feel |
| Metadata | D1 | Free tier, SQL |
| VM connections | One Durable Object per server, holding the agent's WebSocket (hibernation API) | Outbound-only from the VM, no inbound ports, free tier |
| daemons-agent | Go (owner, 2026-10-06), one static binary, also provides the `daemons` CLI | Easy download, solid PTY support |
| Installer | One POSIX shell script, versioned, served by the control plane | No Ansible, no images |
| Homepage | Static site on Cloudflare (Workers static assets) | Same stack, no server |

## Repository layout

```
control-plane/   Worker, Durable Objects, D1 migrations, UI
agent/           daemons-agent + daemons CLI (Go)
installer/       cloud-init template + install.sh
website/         daemons.run homepage
specs/           these epics
```

## Design source

Look and feel, mascot images and brand come from the old project (`~/Herd/daemons-run`): `specs/01-ui/styleguide.md` ("Terminal Lime"), `resources/css/app.css` tokens, `public/images/`. We take the look, not the code.

## Rules for every epic

- **UX first.** Every epic names the screen states: empty, loading, error, success. No dead ends; every error says what to do next.
- **Smallest thing that works.** No abstraction for a second provider, user or region until it exists.
- **Free tier.** A normal single user stays within Cloudflare's free tier. Anything that risks that is called out in the epic.
- **The VM keeps working without the control plane.** Nothing on the VM depends on the control plane being up.
