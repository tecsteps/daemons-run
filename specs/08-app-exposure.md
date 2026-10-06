# 08 — App exposure

## Goal

Any app listening on `localhost:<port>` on the VM is reachable at a stable URL, `https://daemons.<account>.workers.dev/apps/<name>`, with no deployment and no domain.

## User value

"Show me what you built" from any device, in seconds. This is the feature people will remember.

## Scope

- **Expose**: `daemons expose 3000 --name shop` on the VM, or the **Expose** button on a detected port in the UI.
- **Port detection**: the agent reports listening TCP ports with their process and project folder (heartbeat). The UI suggests "Port 5173 (vite, /projects/shop) — Expose?".
- **Routing**: the Worker matches `/apps/<name>/*`, forwards the request over the agent connection (`http.request` / `http.response`, streamed bodies, WebSocket upgrade for HMR), and the agent calls `127.0.0.1:<port>`.
- **Access**: private by default (passkey session required). Per app toggle **Public link** for sharing with others; public apps show a clear badge.
- **Base path**: apps are served under `/apps/<name>/`. The agent sets `X-Forwarded-Prefix`. The UI shows framework hints (Vite `--base`, Next `basePath`, Laravel `ASSET_URL`) when an app returns HTML with root-absolute asset paths.
- **Apps** page: name, port, project, server, private/public, status (up / not listening), open, copy link, unexpose.

## Decision: transport (owner, 2026-10-06)

Proxy through the existing agent WebSocket (Durable Object), not Cloudflare Tunnel + Workers VPC, for v1:
- No extra daemon (cloudflared) and no runtime Cloudflare API token, so `daemons expose` works instantly.
- One connection to secure, one failure mode.
- Revisit Tunnel / Workers VPC if throughput or free tier request limits become a real problem (watch: large bodies, many HMR messages).

## Out of scope

Custom domains, subdomain-per-app, TLS certificates, load balancing, rate limiting.

## UX states

- App exposed but nothing listening: a friendly daemons page "shop is exposed but nothing is listening on port 3000 — start it in a terminal" instead of a 502.
- Server offline: a page saying the server is offline, with the last-seen time.
- Root-absolute assets detected: an inline hint on the Apps page, not a broken page with no explanation.

## Acceptance

- Vite dev server with `--base /apps/shop/` works from a phone, including hot reload.
- A plain Express or Laravel app works at `/apps/<name>/`.
- A private app returns the sign-in page to someone without a session; a public app does not.
- Exposing and unexposing takes effect in under 2 seconds.
