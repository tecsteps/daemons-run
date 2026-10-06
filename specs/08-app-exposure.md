# 08 — App exposure

## Goal

Any app listening on `localhost:<port>` on the VM is reachable at a stable URL, `https://daemons-apps.<account>.workers.dev/<name>/`, with no deployment and no domain.

## User value

"Show me what you built" from any device, in seconds. This is the feature people will remember.

## UI reference

Reuse from the old project: [ui-reference.md](ui-reference.md), sections "Apps / previews".

## Decision: a separate origin for apps (owner, 2026-10-06)

Apps never share an origin with the control plane. App JavaScript on the control plane's origin could call `/api/*` with the owner's session (cookies are sent with script requests even when HttpOnly), so one bad npm package in a dev app could take over the control plane.

- **Apps gateway**: a second, tiny, stateless Worker named `daemons-apps`, so its URL is `https://daemons-apps.<account>.workers.dev`. It forwards every request to the control plane through a service binding, tagged as app traffic. All logic stays in the control plane.
- The control plane serves app traffic **only** when it arrives through the gateway, and serves its UI and API **only** on its own hostname.
- Apps share the gateway origin with each other. That is acceptable for a single owner; the UI says so in one line on the Apps page.
- Deploying the gateway: the install script (03, path B) deploys both Workers. With the Deploy button (path A), which deploys one Worker per button, the Apps page shows **Enable app links** with a second Deploy button the first time the user exposes an app. The control plane detects the gateway with `GET https://daemons-apps.<account>.workers.dev/_daemons/health`.

## Decision: transport (owner, 2026-10-06)

Proxy through the existing agent WebSocket (Durable Object), not Cloudflare Tunnel + Workers VPC, for v1:
- No extra daemon (cloudflared) and no runtime Cloudflare API token, so `daemons expose` works instantly.
- One connection to secure, one failure mode.
- Revisit Tunnel / Workers VPC if throughput or free tier request limits become a real problem (watch: large bodies, many HMR messages).

## Scope

- **Expose**: `daemons expose 3000 --name shop` on the VM, or the **Expose** button on a listening port in the UI.
- **Port detection**: on demand (when the Apps or server page is open), the agent lists listening TCP ports (IPv4 and IPv6 loopback) with the process name and working directory. The UI suggests "Port 5173 (vite, /projects/shop) — Expose?".
- **Routing**: the gateway forwards `/<name>/*`; the control plane looks up the app, sends `http.request` over the agent connection (streamed bodies, WebSocket upgrade for HMR) and the agent calls the app on loopback.
- **Proxy rules** (keep them few and explicit):
  - the prefix `/<name>` is kept on the request path; the agent sets `X-Forwarded-Prefix: /<name>`, `X-Forwarded-Host`, `X-Forwarded-Proto: https`;
  - `Location` headers pointing at `localhost:<port>` are rewritten to the public URL;
  - the gateway's own auth cookie (`__daemons_app`) is stripped before proxying; app cookies pass through;
  - app streams have flow control and a lower priority than terminal traffic, so a big download never stalls a terminal.
- **Access**: private by default. Opening a private app without an app session redirects to the control plane, which checks the passkey session and redirects back with a single-use ticket (60 s). The gateway origin then sets its own session cookie (`__daemons_app`, HttpOnly, Secure, SameSite=Lax, 12 h). Per app toggle **Public link** for sharing; public apps show a clear badge.
- **Supported setups**: apps that can run under a base path. The UI shows a recipe when an app returns HTML with root-absolute asset paths: Vite `--base /<name>/`, Next.js `basePath`, Laravel `ASSET_URL` / `APP_URL`, Express mounted on a router. Anything else shows "This app needs a base path" with the recipe link, never a silently broken page.
- **Apps** page: name, port, project folder, server, private/public, status (up / not listening), open, copy link, unexpose.

## Out of scope

Custom domains, subdomain per app, TLS certificates, load balancing, rate limiting.

## UX states

- Gateway not deployed yet: Apps page shows **Enable app links** with the Deploy button and one sentence on why it is a separate address.
- App exposed but nothing listening: a friendly daemons page "shop is exposed but nothing is listening on port 3000 — start it in a terminal" instead of a 502.
- Server offline: a page saying the server is offline, with the last-seen time.
- Root-absolute assets detected: the recipe hint on the Apps page.

## Acceptance

- JavaScript on an exposed app cannot read or call anything on the control plane's origin (test: an app page that tries `fetch('https://daemons.<account>.workers.dev/api/servers', {credentials: 'include'})` fails).
- Vite dev server with `--base /shop/` works from a phone, including hot reload.
- An Express app mounted at `/shop` and a Laravel app with `APP_URL` set work.
- A private app sends a signed-out visitor to sign-in; a public app does not.
- Exposing and unexposing takes effect in under 2 seconds.
- A 100 MB download through an app does not make a terminal on the same server lag noticeably.
