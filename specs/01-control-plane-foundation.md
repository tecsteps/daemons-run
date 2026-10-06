# 01 — Control plane foundation

## Goal

A deployable Worker with D1 and the dashboard shell, so every later epic only adds screens and endpoints.

## User value

The user opens their own URL and sees a polished, fast, familiar daemons.run dashboard, even before anything exists.

## UI reference

Reuse from the old project: [ui-reference.md](ui-reference.md), sections "Design system", "Mascot and illustrations", "App shell and building blocks".

## Scope

- Worker `daemons` (Hono) with routes `/api/*`, `/agent/*` (reserved for 05) and static assets for the UI. App traffic is never served on this hostname (08).
- D1 database with a migrations folder; migrations run on deploy. First schema: `passkeys`, `setup_state`, `auth_challenges`, `sessions`, `providers`, `servers` (unique name), `enrollment_tokens` (hashed), `agent_credentials` (hashed), `apps` (unique name), `app_tickets`. Later epics add columns, not new concepts.
- SQLite-backed Durable Object classes (`new_sqlite_classes`, required on the free plan): `ServerConnection` (one per server, filled in 05) and `KeyVault` (one instance, holds the credential encryption key, 04).
- **Minimal deploy and setup from day one:** `npm run install-control-plane` (03 path B, first version) creates D1, applies migrations, deploys, sets `SETUP_CODE` and prints the setup link. The Deploy button and `install.md` polish come in 03.
- UI shell from the old project, rebuilt lean:
  - black 240px rail with the `> <` mark and `daemons.run` wordmark, white canvas, light and dark theme;
  - rail: **Servers**, **Projects**, **Apps**, **Settings**; bottom: system status line;
  - phone: black top bar plus bottom navigation;
  - Terminal Lime tokens, Inter + Geist Mono, lime primary button with the hard lower edge.
- Shared components: `Page`, `SectionCard`, `StatusPill`, `EmptyState` (with the flat mascot illustrations), `Button`, `FormField`, `ConfirmDestructive`, `InstrumentSurface`.
- Copy over the mascot images and favicons from the old project.
- Local development: `wrangler dev` with local D1; one command to start.

## Out of scope

Command palette, notifications, multiple users, teams, billing, telemetry.

## UX states

- First load with no data: every list page shows its mascot empty state with one clear primary action.
- API error: an inline notice with a retry, never a blank page.
- 404: the old "not found" illustration with a link back.

## Acceptance

- `npm run deploy` deploys Worker, assets and migrations to a fresh account in one step.
- Dashboard looks like the old one on desktop (1440) and phone (390), light and dark (checked with screenshots).
- Lighthouse performance ≥ 90 on the shell; the UI bundle stays under 300 KB gzipped.
- Stays within the Workers free tier at idle.
- Every UI screen works at 390 px width (mobile view first, emulator check before the epic closes).
