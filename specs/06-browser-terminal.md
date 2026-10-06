# 06 — Browser terminal

## Goal

A fast, reliable terminal on the VM in the browser, good enough to run Claude Code or Codex all day, also on a phone.

## User value

This is where the work happens. The user signs into their coding agent once and it keeps working on the VM, reachable from any device.

## UI reference

Reuse from the old project: [ui-reference.md](ui-reference.md), sections "Browser terminal".

## Scope

- xterm.js in the UI (Geist Mono, the old terminal styling), WebSocket from the browser to the server's Durable Object, relayed to the agent.
- **Sessions survive disconnects.** Every terminal is a tmux session on the VM, running as `daemon`. Closing the tab or losing Wi-Fi does not kill Claude Code; reopening attaches again.
- Terminal tabs per server: list existing tmux sessions, new terminal, rename, close (kills the session after confirmation).
- New terminal opens in a chosen directory (default `/projects`, or a project's folder from 07).
- Quick start buttons on an empty terminal: one per coding agent installed on that server (Claude Code, Codex, OpenCode) plus **Shell**.
- Copy and paste, link click, resize, font size (A-/A/A+), full screen.
- **Mobile is a first-class target, not a fallback.** On a phone:
  - the terminal resizes with the on-screen keyboard (`visualViewport`), so the prompt line is never hidden behind it;
  - an extra key row above the keyboard: Esc, Tab, Ctrl (sticky modifier), arrows, `/`, `|`, `~`, and a Paste button;
  - no zoom on focus, autocorrect, autocapitalize and spellcheck off, so input reaches the PTY unchanged;
  - touch scrolling through scrollback, and long-press to select and copy;
  - portrait and landscape both work, and rotating keeps the session and redraws cleanly;
  - tap targets at least 44 px; the terminal uses the full width below the server header.
- Connection status line: Connected · latency, or Reconnecting… with automatic reattach.

## Out of scope

Chat UI on top of agents, session recording, shared sessions, SSH key management.

## UX states

- Server offline: the terminal area shows "Server offline since 10:32" instead of a dead black box.
- Reconnecting: input is buffered or clearly paused; never lost silently.

## Acceptance

- Open a terminal, run `claude`, log in, start a task, close the laptop, open the phone: the same session is there and still running.
- Typing latency feels local on a normal connection (relay adds less than 50 ms within Europe).
- Full-screen TUIs (Claude Code, Codex, htop, vim) render correctly, including box drawing and colors.
- Works on phones, verified in two stages:
  1. **During development:** the browser's mobile view (Playwright device emulation at 390×844, iPhone and Pixel profiles) for layout, the key row and keyboard resizing.
  2. **Final check:** real mobile browsers on this machine: Safari in the iOS Simulator (Xcode, iPhone 17 Pro) and Chrome in the Android emulator (`daemons_pixel_8_api_35`). Run Claude Code in a terminal, type with the on-screen keyboard, use Ctrl+C and the arrows from the key row, scroll back, copy and paste, rotate, then background the browser and return: the session reattaches.
