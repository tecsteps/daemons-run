# 03 — Installation: QA notes

## 2026-10-06, path B (coding agent) on the real Cloudflare account

- A fresh Sonnet agent got only the one-line prompt ("Install daemons.run into my Cloudflare account: follow …/install.md", preview URL) plus API-token credentials instead of the browser login. It cloned the public repo, ran `npm install` and `npm run install-control-plane`: Workers `daemons` and `daemons-apps` and D1 `daemons` deployed, setup link printed. 66 s, no errors, no help needed.
- Claimed with the setup link (E2E suite, virtual passkey): passkey registered; the same code no longer works.
- Rerun of the installer on the existing install: "already set (kept)", data and passkey still valid (sign-in passes).
- `npm run reset-access`: new setup code opens setup; completing it on another browser revokes the old passkey (`e2e/02-recovery.spec.ts`).
- The test install (both Workers and the D1 database) was deleted afterwards; only `daemons-dev`, `daemons-apps-dev` and `daemons-run-website` remain.
- install.md improved from the agent's notes: API-token alternative to `wrangler login`, runtime, audit warnings, keep the link out of logs.

## Path A (Deploy to Cloudflare button)

Prepared: `control-plane/` builds standalone (the button turns that folder into a new repo), `deploy` script runs D1 migrations then deploys, `.dev.vars.example` makes the button ask for `SETUP_CODE` (description in `package.json` `cloudflare.bindings`). Not yet run for real: the owner clicks it once (agreed for 2026-10-07), then I verify and clean up.
