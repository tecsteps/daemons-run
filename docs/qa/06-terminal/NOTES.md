# 06 — Browser terminal: QA notes

## 2026-10-06, slice 1 (real agent in a container, local control plane)

Suite `e2e/06-terminal.spec.ts` with `AGENT_CONTAINER` = an `ubuntu:24.04` container running the real
`daemons-agent` (linux/arm64 build), enrolled through "Add existing server" against local `wrangler dev`: passed.

- Quick start (Claude Code / Shell) on an empty server; Shell opens a tmux session in `/projects`.
- Typing reaches the PTY (`echo hello-$((40+2))` → `hello-42`); box drawing renders.
- A running loop survives a page reload; the session reattaches and keeps counting; `tmux -L daemons ls` shows it.
- Ctrl+C stops the loop.
- New tab (`shell-2`), switching tabs reattaches with the scrollback.
- Phone (390×844, touch): key row visible; sticky Ctrl + `c` interrupts `sleep 100`; ↑ recalls history; Select shows the scrollback as selectable text with Copy.
- Screens: quick start and shell, desktop and phone, light and dark; select sheet on phone.
- Fixed on the way: a stale socket's close handler cleared the live socket (input lost); tab switching kept the old "connected" state.

Still open: a real Hetzner server, Claude Code login and TUI, latency in Europe, iOS Simulator and Android emulator checks.

## 2026-10-06, real Hetzner CAX11 (nbg1) via daemons-dev

- Terminal attaches, commands run as `dev` in `/projects`. Status line showed 146 ms (desktop) and 174 ms (phone emulation) browser↔Durable Object round trip: above the < 50 ms target; to be investigated.

## 2026-10-06, iOS Simulator (iPhone 17 Pro, iOS 26.5, Safari) against daemons-dev / dev-arm-1: `e2e/mobile/ios.mjs`

- Safari in the Simulator ignores WebDriver virtual authenticators (create() times out on every transport), so the phone uses the desktop session cookie. The phone passkey flow (Settings → Add a phone) is covered in Chromium (`e2e/02-device-link.spec.ts`) and needs one manual check on a real iPhone.
- Servers, terminal, projects, apps, settings render correctly; no horizontal overflow. The status line read "Connected · 33 ms" from the Simulator (the 146 ms seen earlier came from the headless test browser).
- Typing reaches the shell; ↑ from the key row works.
- Findings: one WebDriver tap toggles the sticky Ctrl twice and opens+closes the Select sheet (handed to the terminal port, which rewrites the key row). Backgrounding Safari ends the WebDriver session, so background/return is checked on Android.
- Fixed: on phones a card's header actions (e.g. "Connected · added …") squeezed its description; they now stack below the title.
