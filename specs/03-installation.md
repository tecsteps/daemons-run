# 03 — Installation

## Goal

Getting from "I've heard of daemons.run" to "my control plane is running" takes under five minutes, with no manual Cloudflare setup.

## User value

No tokens to create, no databases to click together, no YAML. Click, sign in to Cloudflare, done.

## Two paths

### A. Website (Deploy to Cloudflare button)

- The daemons.run homepage has an **Install** button using Cloudflare's "Deploy to Cloudflare" flow on the public GitHub repo.
- Cloudflare handles login or signup, forks the repo into the user's GitHub, provisions the D1 database from `wrangler.jsonc` and deploys.
- On first visit with no passkey and no setup token, the control plane shows a **claim** screen: it generates a setup token and asks the user to confirm ownership. It shows a one-time code that the user copies from the Worker's logs in the Cloudflare dashboard (or runs one Wrangler command). Only someone with Cloudflare account access can claim it.
- Updates: the user's fork gets updates by syncing with upstream; Workers Builds redeploys automatically.

### B. Local coding agent

- The homepage shows a copyable prompt: "Install daemons.run into my Cloudflare account: follow https://daemons.run/install.md".
- `install.md` is written for agents: clone the repo, `npx wrangler login` (browser OAuth), `npm run install-control-plane`.
- That script creates D1, applies migrations, sets secrets, deploys, mints the setup token and prints the setup link (02).
- Rerunning it is safe: it updates in place and never drops data.

## Scope

- `wrangler.jsonc` that works with both paths (D1 binding auto-provisioned, no hard-coded IDs).
- `install-control-plane` script, idempotent.
- `install.md` for agents, tested with Claude Code and Codex.
- Worker name `daemons` so the URL is `daemons.<account>.workers.dev`. If the account has no `workers.dev` subdomain yet, the script registers one.

## Out of scope

Custom domains (documented as an optional manual step only), Terraform, multi-account installs.

## UX states

- Already installed: the script says so, updates and prints the existing URL.
- `wrangler login` missing or expired: clear instruction, then continue.
- Claim screen: explains in one sentence why the code is needed.

## Acceptance

- Fresh Cloudflare account → working setup link in under five minutes via both paths.
- Claude Code completes path B from the one-line prompt without help.
- Rerunning install on an existing control plane keeps all data.
