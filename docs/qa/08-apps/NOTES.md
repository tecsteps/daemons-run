# 08 — App exposure: QA notes

## 2026-10-06, slice 1 (real agent in a container, local control plane + local apps gateway)

Suite `e2e/08-apps.spec.ts` (`AGENT_CONTAINER`, `APPS_URL=http://localhost:8790`): passed.

- `daemons expose 3000 --name shop` on the server prints the app URL; the Apps page lists it as Private.
- Owner opens the app URL: redirect through the control plane ticket, back to the app with the app cookie, ticket removed from the URL.
- A signed-out visitor is sent to sign-in. After switching to Public link, the same visitor sees the app.
- An app exposed on a port where nothing listens shows "ghost is not running" instead of a bare 502.
- Unexpose takes effect at once (< 2 s): "ghost is not exposed".
- A listening port without an app shows up as an offer on the Apps page; Expose turns it into an app.

Still open: the cross-origin check on real workers.dev origins (locally both run on `localhost`, which shares cookies across ports), Vite HMR over the WebSocket proxy, Express/Laravel recipes, a 100 MB download next to a terminal, phone check.

## 2026-10-06, real origins (daemons-dev + daemons-apps-dev, server dev-arm-1): `e2e/real-apps.spec.ts` passed

- Vite (in Docker, `--base /shop/`) exposed with `daemons expose 5173 --name shop`; Docker published it on 127.0.0.1 only (installer's daemon.json).
- Private app: owner gets the page via the ticket flow, URL clean afterwards; signed-out visitor lands on the control plane's /login.
- Vite's HMR WebSocket connects through the proxy (`[vite] connected`); editing `src/main.js` updates the page live ("HMR works").
- Cross-origin: `fetch(<control plane>/api/servers, {credentials: 'include'})` from the app page is blocked; a `no-cors` POST to `/api/auth/logout` does nothing (owner still signed in: origin check).
- 100 MB download through an app: 104857600 bytes in 6.1 s. Terminal echo round trips during the download (typing + screen poll, from this machine): 158–421 ms, baseline 138–155 ms. No stall.
- Screens: the proxied Vite app, desktop dark and phone light.
