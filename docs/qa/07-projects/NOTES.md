# 07 — Projects: QA notes

## 2026-10-06, slice 1 (real agent in a container)

Suite `e2e/07-projects.spec.ts` (`AGENT_CONTAINER`): passed.

- `mkdir /projects/foo` on the server → foo appears in the list.
- New project with a public Git URL (name derived from the URL) clones and opens a terminal in the folder (`pwd` = `/projects/hello`); the card shows the branch.
- A missing/private repository says to sign in with `gh auth login` and links a terminal.
- Delete with typed name removes the folder and nothing else.
- Fixed: "Open terminal here" was invisible in dark mode (the old CSS remaps bone inside `.bg-ink-900`); new `ink` button variant.

Still open: Compose start/stop and delete with containers (needs Docker: real server).
