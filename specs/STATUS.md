# Status

Where the build stands, so work can resume after a context reset. Newest first within each list.

## Done

- 12 (part): root files (LICENSE, README, CONTRIBUTING, SECURITY, AGENTS.md, .editorconfig, .env.example), npm workspaces, CI (`ci.yml`).
- 01 (first slice): Worker (Hono) with D1 schema, `ServerConnection` and `KeyVault` Durable Objects, React shell (rail, phone bars, empty states, 404) in the Terminal Lime look, `npm run install-control-plane` (idempotent, creates D1, migrations, deploys both Workers, setup code).
- 02 (first slice): setup code + first passkey, sign-in, sign-out, sessions, passkey add/rename/delete, origin checks. E2E (virtual authenticator) passes locally and on daemons-dev.

## In progress

- 05: Go agent, installer, release workflow (subagent).
- 04: provider connect, create-server form, server page.

## Next

04 + 05 → 06 → 08 → 07 → 03 → 10 → 09.

## URLs

- Control plane (dev): https://daemons-dev.fabian-wesner.workers.dev
- Apps gateway (dev): https://daemons-apps-dev.fabian-wesner.workers.dev

## How to verify

- `npm test` (unit), `cd control-plane && npx playwright test` (E2E against local `wrangler dev`, port 8787).
- Against daemons-dev: `SETUP_CODE=$(cat control-plane/e2e/.auth/setup-code-daemons-dev) BASE_URL=https://daemons-dev.fabian-wesner.workers.dev npx playwright test`.
- Screenshots land in `docs/qa/<epic>/` (desktop 1440 and phone 390, light and dark).

## Decisions to review

- daemons-dev is claimed by the E2E suite's virtual passkey (stored in the git-ignored `control-plane/e2e/.auth/`). To use daemons-dev with your own passkey, run `npm run reset-access -- --name daemons-dev` and open the printed link; the E2E suite then needs that new code in `control-plane/e2e/.auth/setup-code-daemons-dev`.
- Hetzner CX23 is currently sold out in every location (API, 2026-10-06 19:00); test servers use CAX11 until it is back.

## Open decisions

None.
