# 01 — Control plane foundation

## Goal

A deployable Worker with D1 and the dashboard shell, so every later epic only adds screens and endpoints.

## User value

The user opens their own URL and sees a polished, fast, familiar daemons.run dashboard, even before anything exists.

## Scope

- Worker (Hono) with routes `/api/*`, `/apps/*` (reserved for 08), `/agent/*` (reserved for 05) and static assets for the UI.
- D1 database with a migrations folder; migrations run on deploy.
- Durable Object class `ServerConnection` declared (filled in 05).
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
