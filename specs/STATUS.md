# Status

Where the build stands, so work can resume after a context reset.

## Done (verified, evidence in docs/qa/)

- **12** repo basics: README (install first), LICENSE, CONTRIBUTING, SECURITY, AGENTS.md, CI (`ci.yml`: typecheck, tests, build, gitleaks CLI over all history), agent workflow, rolling `dev` pre-release + tagged releases (`release.yml`).
- **01** Worker (Hono), D1 schema, `ServerConnection` + `KeyVault` Durable Objects, React shell in the Terminal Lime look, `npm run install-control-plane` (idempotent; D1, migrations, both Workers, setup code).
- **02** setup code + first passkey, sign-in/out, sessions, passkey add/rename/delete, origin checks, 401 matrix.
- **04** Hetzner connect (encrypted token), grouped full type list, confirm dialog, durable creation, progress view, retry install (rebuild), typed delete, add existing machine. Real CAX11 online through the UI in 131 s.
- **05** Go agent + CLI per `agent/PROTOCOL.md`, installer (Docker, ufw, git, gh, tmux, coding agents, systemd), tested in a container and on Hetzner. No listener added by daemons.
- **06** terminal: tmux sessions survive reloads, tabs, Ctrl/arrows key row, select sheet, reconnect; works with the real agent locally and on Hetzner.
- **07** projects: live list, new/clone, open terminal here, delete (container-tested; Compose on a real server pending).
- **08** apps: CLI expose, private ticket flow, public toggle, friendly not-running page, unexpose, port offers (local gateway).

## In progress

- 06: porting the pre-pivot per-agent terminal behaviour (tmux mouse/copy-mode, wheel bindings per agent, touch gestures) — owner instruction 2026-10-06. Android check (`e2e/mobile/android.mjs`) is its acceptance.
- Agent capability test with OpenCode free models on dev-arm-2 (installs, Playwright, preview URL).
- x86 test server (CX23 available again).

## Done since the last update

- 09 files: browse, CodeMirror edit/save, conflict check, 50 MB upload checksum, downloads, .tar.gz.
- 02 add-a-device link (QR, single use) for phones whose passkeys don't sync; recovery via reset-access verified.
- 03 path B verified end to end by a fresh coding agent from the one-line prompt (66 s), rerun keeps data; test install removed.
- 10 homepage on the preview URL, Lighthouse 99–100.
- 08 on real origins: HMR, cross-origin isolation, 100 MB download vs terminal.
- iOS Simulator and Android emulator checks running (see docs/qa/06-terminal/NOTES.md).

## Next

Path A Deploy button (owner clicks it 2026-10-07), finish 06 port + mobile rechecks, v0.1.0 release, final full-flow run on a fresh CX23, final report.

## URLs

- Control plane (dev): https://daemons-dev.fabian-wesner.workers.dev
- Apps gateway (dev): https://daemons-apps-dev.fabian-wesner.workers.dev

## Test servers (Hetzner, label daemons-control-plane=daemons-dev.fabian-wesner.workers.dev)

- `dev-arm-1`: CAX11, nbg1, €5.99/month, created 2026-10-06 (no SSH key).
- `dev-arm-2`: CAX11, all three coding agents, SSH key `control-plane/e2e/.auth/dev_ed25519` (git-ignored), created 2026-10-06.
- `dev-x86-1`: CX23, being created 2026-10-06.

## How to verify

- Unit: `npm test`. Agent: `cd agent && go test ./...`. Installer: `installer/test/run.sh` (Docker).
- E2E local: `cd control-plane && npx wrangler dev --local --ip 0.0.0.0` (+ `cd apps-gateway && npx wrangler dev --local --port 8790`), then `AGENT_CONTAINER=<container> APPS_URL=http://localhost:8790 npx playwright test`. `.dev.vars` needs `SETUP_CODE`, `HETZNER_API_BASE=http://localhost:8788/v1`, `APPS_ORIGIN`, `CONTROL_PLANE_ORIGIN`.
- E2E on daemons-dev: `BASE_URL=https://daemons-dev.fabian-wesner.workers.dev`, plus `REAL_HETZNER=1` (buys a cheapest-tier server) or `REAL_SERVER=<name>`.
- Screenshots: `docs/qa/<epic>/` (desktop 1440 and phone 390, light and dark).

## Decisions to review

- **VM user `dev`** (owner, 2026-10-06): Ubuntu's `daemon` account is taken.
- **daemons-dev is claimed by the E2E suite's virtual passkey** (`control-plane/e2e/.auth/`, git-ignored). To use it yourself: `npm run reset-access -- --name daemons-dev`, open the link; then save the new code in `control-plane/e2e/.auth/setup-code-daemons-dev` and rerun the suite's setup.
- **CX23 sold out** in every location (API, 2026-10-06): test servers use CAX11 (Arm, €5.99).
- **Price claim**: "Hetzner from about €5.50/month" instead of "about €4" (cheapest type is €5.49).
- **systemd `KillMode=process`** for the agent, so restarting it never kills tmux sessions.
- **Mobile copy/select**: a "Select" key opens the scrollback as native selectable text (xterm's own touch selection is unreliable on phones).
- **Terminal latency**: the status line reads 33 ms from the iOS Simulator; the 146–174 ms seen earlier came from the headless test browser.
- **Phones without a synced passkey** sign in through Settings → Add a phone (QR link, single use, 10 min).
- **Hero art** on the homepage still shows a small "Cursor" chip from the old artwork.

## Open decisions

None.
