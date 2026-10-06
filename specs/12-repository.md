# 12 — Repository and releases

## Goal

`github.com/tecsteps/daemons-run` is a public, MIT-licensed repository that a developer understands in a minute, can install from in five, and can contribute to without asking.

## User value

Trust. Users run this in their own Cloudflare account and on their own servers, so the code, the license and the release artifacts must be easy to inspect and verify.

## Scope

### Files at the root

- `LICENSE`: MIT, "Copyright (c) 2026 Tecsteps GmbH". Done.
- `README.md`, in this order and short:
  1. One-line pitch, the mascot image and one dashboard screenshot (from the old project until the new UI exists).
  2. **Install**: the Deploy to Cloudflare button and the one-line coding-agent prompt (03).
  3. How it works: the architecture diagram from the brief (browser → your Cloudflare control plane → agent connection → your VM), 5 lines max.
  4. What it costs: free and open source; you pay your server provider; normal use fits Cloudflare's free plan.
  5. Security model in five bullets: passkeys only, outbound-only agent connection, apps on a separate origin, provider credentials encrypted, everything in your own accounts.
  6. Development quick start (`npm install`, `npm run dev`), repository layout, links to `specs/` and `CONTRIBUTING.md`.
  7. License: MIT.
- `CONTRIBUTING.md`: how to run each part locally, test commands, commit style, "open an issue before a big change".
- `SECURITY.md`: how to report a vulnerability privately (GitHub private vulnerability reporting), what is in scope.
- `AGENTS.md` (and `CLAUDE.md` pointing to it): short rules for coding agents working on this repo: read `specs/00-overview.md` first, keep it small, reuse old UI via `specs/ui-reference.md`, check mobile, never commit `.env`.
- `.gitignore` (done), `.editorconfig`, `.env.example` listing every variable used in development (names only).

### Layout

npm workspaces for `control-plane/`, `apps-gateway/`, `website/`; Go module in `agent/`; `installer/` plain shell. One root `npm run dev`, `npm test`, `npm run lint`.

### CI (GitHub Actions)

- On every push and pull request: TypeScript type check, lint and unit tests for the workspaces; `go vet` and `go test` for the agent; `shellcheck` for the installer; a secret scan (gitleaks).
- Keep the whole run under 5 minutes.

### Releases

- A tag `vX.Y.Z` builds `daemons-agent` for linux amd64 and arm64, writes `SHA256SUMS`, and publishes a GitHub release with them and `install.sh`.
- The control plane serves `install.sh` pinned to its own release version, so a control plane and the agents it installs always match (05).
- Before the first tagged release, CI publishes a rolling `dev` pre-release from every push to `main` (agent binaries + `SHA256SUMS`); development control planes install from it.
- Release notes from merged pull requests; semantic versioning; a `CHANGELOG.md` only once there are users.

### GitHub settings

Public repo, `main` protected (CI must pass), issues on, discussions off for now, private vulnerability reporting on, topics (`coding-agents`, `cloudflare-workers`, `self-hosted`, `hetzner`).

## Out of scope

Docs site, code of conduct beyond GitHub's default, signed releases (checksums are enough for v1), package registries, Homebrew.

## Acceptance

- A new visitor finds the Install button within the first screen of the README.
- A fresh clone runs `npm install && npm test` green, and `npm run dev` starts the control plane locally.
- Tagging a release produces both agent binaries and checksums without manual steps.
- No secret is ever committed (CI secret scan passes on all history).
