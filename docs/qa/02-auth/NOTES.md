# 02 — Passkey auth: QA notes

2026-10-06, local and daemons-dev, suite `e2e/01-02-shell-auth.spec.ts` (Chromium virtual authenticator): passed.

- Setup page reads the code from the `#code=` fragment; a wrong code shows the attempts left.
- Setup with the right code registers the first passkey and lands on Servers with the "add a second device" hint.
- After setup, `POST /api/setup/options` with the same code answers 409 (closed).
- Cross-origin `POST` with a valid cookie answers 403.
- Sign out → `/login`; sign in with the stored passkey works.
- Without a session, `/api/servers`, `/api/passkeys`, `/api/sessions`, `/api/providers`, `/api/apps`, `/api/settings/ssh-key` answer 401.
- Open: recovery via a changed `SETUP_CODE`, and sign-in on a real phone (emulator check before the epic closes).
