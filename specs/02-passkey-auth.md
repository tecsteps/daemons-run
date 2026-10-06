# 02 — Passkey authentication

## Goal

Only the owner can use the control plane, using passkeys only. No passwords, no email, no third-party login.

## User value

Sign-in is one touch (Face ID, Touch ID, security key, phone). Nothing to remember, nothing to leak.

## Scope

- **Setup link.** Installation (03) creates a one-time setup token and prints `https://daemons.<account>.workers.dev/setup#<token>`. Opening it lets the user register the first passkey. The token is single-use and expires after 24 hours.
- **Sign-in.** One button: "Sign in with passkey". WebAuthn discoverable credentials, so no username field.
- **Session.** HttpOnly, Secure, SameSite=Lax cookie, 30-day sliding expiry; sessions stored in D1 and revocable.
- **Add another passkey** from Settings (e.g. phone plus laptop). Strongly nudged right after setup ("Add a second device so you never get locked out").
- **Manage passkeys:** list with name, created and last used; rename; delete (never the last one).
- **Recovery.** If every passkey is lost: rerun the installer prompt or `npm run setup-link` locally (needs Cloudflare access via Wrangler) to mint a new setup link. Cloudflare account access is the root of trust.
- Library: `@simplewebauthn/server` and `@simplewebauthn/browser`.

## Out of scope

Multiple users, roles, SSO, email, TOTP, passwords.

## UX states

- Setup link expired or used: say so, and show the exact command that makes a new one.
- Browser without passkey support: a plain message naming supported browsers.
- Passkey prompt cancelled: return to the button quietly, with no error wall.

## Acceptance

- The setup link works once and only once.
- With no session, every `/api/*` and UI route except `/setup`, `/login` and `/agent/*` redirects or returns 401.
- After adding a phone passkey, signing in on the phone works.
- Sessions can be revoked from Settings.
