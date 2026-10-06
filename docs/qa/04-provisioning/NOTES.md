# 04 — Server provisioning: QA notes

## 2026-10-06, slice 1 (UI + API against a fake Hetzner API)

Suite `e2e/04-provisioning.spec.ts` against local `wrangler dev` with `HETZNER_API_BASE` pointing at
`e2e/fake-hetzner.ts` (real catalog fixtures from the Hetzner API): passed.

- Connect: a bad token shows Hetzner's rejection; a good one is stored, and `/api/providers` never contains it.
- Create form: name suggestion, location (nbg1 default), the three groups with the cheapest available type, the full list per group with unavailable types behind the switch ("Not available in nbg1"), agent checkboxes.
- Confirm dialog: type, location, monthly price, "starting now", focus on Cancel.
- Order: `cx23` in `nbg1`, labels `managed-by=daemons`, cloud-init user data with the enrollment token and the chosen agents.
- Progress view updates from `/agent/progress` (step `docker`).
- Provider refusal (quota) keeps the form and shows Hetzner's message.
- Typed-name delete removes the server at the provider.
- Existing machine: one-line install command.
- Screens: connect, create form, confirm dialog, progress, server list; desktop and phone, light and dark.

Still open for this epic: a real Hetzner server to Online (needs the agent release, epic 05), the
"Add existing server" path on a real machine, browser-closed-during-creation check.
