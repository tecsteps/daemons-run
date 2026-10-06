# 01 — Shell: QA notes

2026-10-06, local `wrangler dev` and https://daemons-dev.fabian-wesner.workers.dev, suite `e2e/01-02-shell-auth.spec.ts`: passed on both.

- Screens: servers (empty state), projects, apps, settings, 404; desktop 1440 and phone 390, light and dark. No horizontal overflow at either width (asserted).
- Compared with the old dashboard (`specs/2026-09-18-qa/screenshots/dashboard-1440-light.png`, `dashboard-pixel7-dark.png`): black rail, lime active entry, lime CTA with ink border, phone top bar and bottom navigation, mascot empty states.
- UI bundle: 148 KB JS + 55 KB CSS gzipped (< 300 KB).
