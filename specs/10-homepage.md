# 10 — Homepage (daemons.run)

## Goal

daemons.run explains the product in one scroll and gets visitors into a working install.

## User value

A developer understands in 10 seconds what this is, that it is free and theirs, and how to get it.

## UI reference

Reuse from the old project: [ui-reference.md](ui-reference.md), sections "Homepage", "Mascot and illustrations".

## Scope

- Static site, the old homepage's look: always dark, cinematic, 3D mascot art, lime CTAs, black and bone stripes. Same images.
- Header: mark + wordmark, GitHub link (visible on mobile too), **Install** CTA.
- Hero: "Your agents never sleep." (or the old "A development machine that never turns off."), the server cabinet art, **Install** + "Install with your coding agent".
- Sections (one idea each):
  1. How it works: Install → Create a server → Open a terminal → Expose your app.
  2. Your stuff, your accounts: control plane in your Cloudflare, servers in your Hetzner account (or any Ubuntu machine), no SaaS in between.
  3. Your agent: Claude Code, Codex or OpenCode preinstalled; anything else that runs in a terminal works too.
  4. Apps from localhost to a link: `daemons expose 3000`.
  5. Cost: free and open source (MIT). You pay your server provider directly (Hetzner from about €4/month); normal use fits Cloudflare's free plan (say "normal use", not "always").
  6. Final CTA with the mascot.
- `/install` page: the Deploy to Cloudflare button plus the copyable agent prompt (03).
- `/install.md`: the agent-readable install instructions (03).
- Footer: GitHub, docs, imprint, privacy, "Open source · MIT licensed".
- Rewrite all copy for the new product; do not reuse old claims (isolation via containers, teams, €5 pricing, OAuth, Apache-2.0).

## Hosting

`website/` is a static site deployed by Tecsteps to Cloudflare (Workers static assets) on the `daemons.run` domain. `daemons.run` currently serves the old Laravel app, so going live includes the DNS switch; until then the site runs on a `workers.dev` preview URL.

## Out of scope

Blog, docs site (README plus a few markdown pages on GitHub is enough for now), analytics beyond privacy-friendly page counts.

## Acceptance

- Lighthouse ≥ 95 on mobile and desktop.
- From the homepage, a new user reaches a deployed control plane without reading anything else.
- Looks right at 390, 768 and 1440 widths.
