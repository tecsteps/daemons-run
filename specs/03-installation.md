# 03 — Installation

## Goal

Getting from "I've heard of daemons.run" to "my control plane is running" takes under five minutes, with no manual Cloudflare setup.

## User value

No tokens to create, no databases to click together, no YAML. Click, sign in to Cloudflare, type a setup code, done.

## What gets deployed

| Worker | URL | Content |
|---|---|---|
| `daemons` | `https://daemons.<account>.workers.dev` | Control plane: UI, API, Durable Objects, D1 |
| `daemons-apps` | `https://daemons-apps.<account>.workers.dev` | Apps gateway (08): stateless, forwards to `daemons` through a service binding |

Secrets: `SETUP_CODE` (02). There is no encryption-key secret to manage: the key for provider credentials is generated on first use and kept in Durable Object storage, separate from D1 (04).

## Two paths

### A. Website (Deploy to Cloudflare button)

- The daemons.run `/install` page has a **Deploy to Cloudflare** button for the `control-plane/` folder of the public repo.
- Cloudflare handles login or signup, clones the repo into the user's GitHub, provisions D1 and the Durable Objects from `wrangler.jsonc`, asks for `SETUP_CODE` (with a description from `package.json` `cloudflare.bindings`), and deploys.
- The user opens the Worker URL, enters the setup code, registers a passkey (02).
- The apps gateway is a second button (one Worker per button is a Cloudflare limitation). It is offered later, on the Apps page, when the user first exposes an app (08).
- Updates: the user's repo copy is synced with upstream; Workers Builds redeploys.
- **Verify in the first slice:** D1 migrations run on Deploy-button deploys, the secret prompt works, and the gateway's service binding to `daemons` resolves.

### B. Local coding agent

- The homepage shows a copyable prompt: "Install daemons.run into my Cloudflare account: follow https://daemons.run/install.md".
- `install.md` is written for agents: clone the repo, `npx wrangler login` (browser OAuth), `npm run install-control-plane`.
- The script creates or reuses D1, applies migrations, deploys both Workers, generates `SETUP_CODE` if none is set, and prints the setup link (02).
- Rerunning it is safe: it updates in place, keeps D1 and secrets, and never drops data.

## Scope

- `control-plane/wrangler.jsonc` and `apps-gateway/wrangler.jsonc` that work with both paths (no hard-coded IDs; `new_sqlite_classes` for Durable Objects, required on the free plan).
- `install-control-plane` script, idempotent; `reset-access` script (02).
- `install.md` for agents, tested with Claude Code and Codex.
- Worker names `daemons` and `daemons-apps`. If the account has no `workers.dev` subdomain yet, the script registers one; with the button, Cloudflare does.
- Name collision (a Worker called `daemons` already exists and is not ours): stop with a clear message, never overwrite.

## Out of scope

Custom domains (documented as an optional manual step only), Terraform, multi-account installs.

## UX states

- Already installed: the script says so, updates and prints the existing URL.
- `wrangler login` missing or expired: clear instruction, then continue.
- Control plane opened before setup: the setup page, never an error.

## Acceptance

- Fresh Cloudflare account → passkey registered in under five minutes via both paths.
- Claude Code completes path B from the one-line prompt without help.
- Rerunning install on an existing control plane keeps all data and the setup state.
