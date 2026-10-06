# 02 — Passkey authentication

## Goal

Only the owner can use the control plane, using passkeys only. No passwords, no email, no third-party login.

## User value

Sign-in is one touch (Face ID, Touch ID, security key, phone). Nothing to remember, nothing to leak.

## Decision: setup code (owner, 2026-10-06)

Proof of ownership before the first passkey is a **setup code**, a Worker secret `SETUP_CODE`:
- Deploy button (03, path A): the deploy form asks for it ("any phrase you will type once").
- Install script (03, path B): generated randomly and printed as a setup link `https://daemons.<account>.workers.dev/setup#code=<code>` (fragment, so it never reaches logs).

## Scope

- **Setup.** `/setup` asks for the setup code (prefilled from the link fragment), then registers the first passkey. Server side: constant-time compare, at most 5 failed attempts per 15 minutes, and the code is consumed atomically with storing the first passkey. Setup is closed as soon as a passkey exists for the current code (D1 stores a hash of the consumed code).
- **Recovery without local tools.** Change `SETUP_CODE` in the Cloudflare dashboard (Worker → Settings → Variables and secrets). A code whose hash differs from the consumed one opens setup again; completing it **revokes all other passkeys and all sessions**. Cloudflare account access is the root of trust. The install script offers the same as `npm run reset-access`.
- **Sign-in.** One button: "Sign in with passkey". WebAuthn discoverable credentials (no username field), user verification required, RP ID = the exact control plane hostname, exact origin check, single-use challenges stored in D1 with a 5-minute expiry. Library: `@simplewebauthn/server` and `@simplewebauthn/browser`.
- **Session.** Host-only cookie (no `Domain` attribute), HttpOnly, Secure, SameSite=Lax, 30-day sliding expiry; sessions stored in D1. Revoking a session or passkey also closes that session's open terminal WebSockets.
- **Origin check.** Every state-changing `/api/*` request and every browser WebSocket upgrade must carry `Origin` equal to the control plane origin.
- **Add a device link** (decided 2026-10-06): Settings → Add a phone shows a QR code and a single-use link (10 minutes) minted by the signed-in owner; opening it on the other device registers that device's own passkey and signs it in. Needed when passkeys do not sync between the devices (Mac + Android).
- **Add another passkey** from Settings (e.g. phone plus laptop). Strongly nudged right after setup ("Add a second device so you never get locked out").
- **Manage passkeys:** list with name, created and last used; rename; delete (never the last one). Sessions: list and revoke.

## Route and auth matrix

| Route | Auth |
|---|---|
| `/setup`, `/api/setup/*` | setup code (only while setup is open) |
| `/login`, `/api/auth/*` | none (WebAuthn ceremony) |
| `/install.sh` | none (the script contains no secrets) |
| `/agent/enroll`, `/agent/progress` | one-time enrollment token |
| `/agent/connect` | agent credential |
| `/api/apps/ticket` | owner session (mints the app ticket for 08) |
| traffic from the apps gateway | app session or public app (08) |
| everything else | owner session |

## Out of scope

Multiple users, roles, SSO, email, TOTP, passwords.

## UX states

- Wrong setup code: say so with the attempts left; after the limit, say when to try again.
- Setup already done: show sign-in, plus one line on how recovery works.
- Browser without passkey support: a plain message naming supported browsers.
- Passkey prompt cancelled: return to the button quietly.

## Acceptance

- A fresh deploy can be claimed only with the setup code; after the first passkey, the same code does nothing.
- Changing `SETUP_CODE` in the dashboard lets the owner set up a new passkey and logs out every old session and passkey.
- With no session, every route in the "owner session" row returns 401 or redirects to `/login`.
- A cross-origin `POST /api/*` with a valid cookie is rejected.
- After adding a phone passkey, signing in on the phone works.
