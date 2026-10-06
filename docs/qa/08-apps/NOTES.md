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
