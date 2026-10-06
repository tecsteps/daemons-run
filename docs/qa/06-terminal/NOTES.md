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

## 2026-10-06, terminal behaviour from the old project (tmux scrollback, per-harness wheel, gestures)

Ported from old daemons-run (tag `pre-pivot-2026-09-05`): `gateway/src/tmux.js` options and wheel/copy-mode
bindings, `config/agents.php` scroll modes, `TerminalSession.tsx` gestures, `terminalLinks.ts`, `terminalRenderer.ts`.

- Agent: tmux owns the scrollback (`mouse on`, no `smcup@` override); per-session harness in `@daemons_harness` /
  `@daemons_scroll`; Claude Code sessions get `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`; typing in copy mode leaves it
  and reaches the app; new `terminal.capture` for the Select sheet. `go test` covers: wheel report → copy mode with
  scroll position > 0, a key leaves copy mode and reaches bash, capture contains history, OpenCode harness on the
  alternate screen receives `C-M-b` for a wheel report, the conf loads cleanly (tmux 3.7 on macOS, 3.4 in Ubuntu 24.04).
- `e2e/06-terminal.spec.ts` (real agent in `dagent`, local control plane): passed 4 runs in a row. New: 300 lines,
  mouse wheel scrolls tmux history, typing leaves copy mode; phone (CDP touch): drag scrolls, typing leaves copy mode,
  pinch enlarges the font, a tap on a URL that wrapped onto two rows opens the link sheet with the full URL, Select
  shows tmux history (`row-1`, beyond the screen).
- Android emulator (Pixel 8, Chrome, real adb taps/swipes/IME), local control plane via `adb reverse` + container agent:
  `BASE_URL=http://localhost:8787 node e2e/mobile/android.mjs box` passed: keyboard, Ctrl+C, history, 300-line shell
  scroll (two swipes back to row 206, `android-terminal-scrollback.png`), typing leaves copy mode, Select with full
  history (`android-terminal-select.png`), landscape, background and return (`android-terminal-after-background.png`),
  OpenCode 1.18 with the free model (Big Pickle): 60-item answer, three swipes scroll the transcript from item 30 to 1
  (`android-opencode.png`, `android-opencode-scrolled.png`), Claude Code without login renders its welcome screen and
  survives a reload (`android-claude-code.png`, `android-claude-code-reattached.png`).
- Same script against daemons-dev with `dev-arm-2` (still the old agent; `SKIP_AGENTS=1`): passed (browser fallback:
  xterm scrollback scroll, local Select text). Screenshots from that run were overwritten by the local run.
- Fixed on the way: nothing rendered on the Pixel 8 (WebGL at device pixel ratio 2.625): WebGL now only at integer
  ratios, as in the old project. "Background and return" failed because the script recalibrated taps right after
  returning; it now reuses the portrait calibration. Sticky Ctrl ignores a second toggle within 350 ms (iOS Safari
  double click).
- Deviation from the old project: touch drags in copy-mode harnesses and shells send one wheel report per 5 rows
  (the text follows the finger) instead of 8 PageUp keys per swipe; OpenCode keeps one report (one page) per swipe.
  The shell rule is "not on the alternate screen → copy mode" (old: "a shell process and not on the alternate screen").
