# 07 — Projects: QA notes

## 2026-10-06, slice 1 (real agent in a container)

Suite `e2e/07-projects.spec.ts` (`AGENT_CONTAINER`): passed.

- `mkdir /projects/foo` on the server → foo appears in the list.
- New project with a public Git URL (name derived from the URL) clones and opens a terminal in the folder (`pwd` = `/projects/hello`); the card shows the branch.
- A missing/private repository says to sign in with `gh auth login` and links a terminal.
- Delete with typed name removes the folder and nothing else.
- Fixed: "Open terminal here" was invisible in dark mode (the old CSS remaps bone inside `.bg-ink-900`); new `ink` button variant.

Still open: Compose start/stop and delete with containers (needs Docker: real server).

## 2026-10-06, real server dev-x86-1 (CX23): `e2e/real-projects.spec.ts`

- Compose: Start Compose brought up nginx + redis; both show Running.
- **Security finding, fixed:** the published port (8088) listened on 0.0.0.0 and was reachable from the internet, because Docker's `"ip": "127.0.0.1"` only applies to the default bridge and Compose creates its own network (Docker bypasses ufw). The installer now also sets `default-network-opts` `host_binding_ipv4 = 127.0.0.1`; verified on the server: 127.0.0.1 only, not reachable from outside. Installer container test extended.
