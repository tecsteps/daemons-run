# QA: epic 10, homepage (2026-10-06)

Preview: https://daemons-run-website.fabian-wesner.workers.dev (Worker `daemons-run-website`, static assets only).

## What I checked

- **Build**: `npm run build -w website`, and from a clean copy of the repo (no node_modules): `npm ci && npm run typecheck && npm test && npm run build`. All exit 0.
- **Local serving**: `npx wrangler dev` in `website/` (same asset handling as production): `/` and `/install` 200 text/html, `/install.md` 200 `text/markdown; charset=utf-8` (via `public/_headers`), unknown paths 404 with the 404 page.
- **Screenshots** (Playwright Chromium, against the deployed preview): `home-{390,768,1440}.png`, `install-{390,768,1440}.png`, `home-390-menu.png` (mobile menu open). These are captured with a viewport as tall as the page. Chromium's `fullPage` mode drops some `mix-blend-mode` images on long pages, but in the real viewport they render correctly.
- **Horizontal overflow**: `scrollWidth == clientWidth` on both pages at 320, 360, 390, 768, 1024, 1280, 1440 and 1920. I fixed one overflow at 320 on /install (card padding).
- **Against live daemons.run**: same header (mark, wordmark, lime CTA), hero layout (headline, lime first line, CTA pair, mono tagline, server art with `mix-blend-lighten`), USP band, black and bone stripes, lime step numerals, final CTA with the waving mascot on bone, dark footer. Fonts are Inter Variable and Geist Mono, self-hosted via Fontsource.
- **Mobile menu**: the toggle sets `aria-expanded`. Escape and following a link both close it. The GitHub icon and Install stay visible in the header on mobile.
- **Copy**: all of it is new. No containers or isolation claims, no teams, no €5 or OAuth sign-in claims, no Apache-2.0. Hetzner is quoted as "from €5.49/month" (CX23). Cloudflare is described as "normal use fits the free plan". The shell prompt uses `dev@`.

## Lighthouse (lighthouse CLI, headless Chromium)

| Page | Mode | Perf | A11y | Best practices | SEO |
|---|---|---|---|---|---|
| / (local) | mobile | 99 | 100 | 100 | 100 |
| / (local) | desktop | 100 | 100 | 100 | 100 |
| /install (local) | mobile | 100 | 100 | 100 | 100 |
| /install (local) | desktop | 100 | 100 | 100 | 100 |
| / (preview) | mobile | 100 | 100 | 100 | 100 |
| / (preview) | desktop | 100 | 100 | 100 | 100 |

Fixes made along the way: inlined CSS (no render-blocking request), 800w variants plus `srcset` for the three large images, downscaled step icons, and USP headings changed to h2 for heading order.

## Known limits

- The hero art (`art-hero-machine-tight`) still shows a Cursor chip from the old product. The alt text does not mention it.
- `typecheck` runs `astro sync && tsc --noEmit`, not `astro check`. Volar resolves the root TypeScript 7 (from control-plane), which has no JS API yet. So `.astro` templates are not type-checked. The build still catches compile errors in them.
- Imprint and privacy links point to the old pages at https://daemons.run/imprint and /privacy.
