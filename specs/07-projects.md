# 07 — Projects

## Goal

A project is just a directory in `/projects`. The UI makes those directories easy to start, find and jump into.

## User value

One place to see "what am I working on": open the terminal in the right folder, see its running apps and Compose services, without learning any new concept.

## Scope

- The **Projects** list is read live from the VM (`/projects/*`), never stored in D1. A project created with `mkdir` in the terminal shows up.
- Per project: name, server, git branch, exposed apps (08).
- **New project**: name, plus optionally a Git URL to clone. Creates `/projects/<name>`, clones, and opens a terminal there.
- Project actions: **Open terminal here**, **Expose app** (08), **Delete** (typed-name confirmation; runs `docker compose down` first when a Compose file exists, then deletes the folder).
- Second slice, once the first works: Compose services and their state, **Start Compose** / **Stop Compose**.
- Git over HTTPS uses whatever credentials the user configures on the VM. We do not manage Git tokens. A failed private clone says so and offers **Open terminal** with `gh auth login` ready to run.

## Out of scope

Project templates, per-project isolation, per-project resource limits, GitHub app integration, environment variable management (later, with 11's secrets work).

## UX states

- Server offline: show the last list with a clear "offline, data from 10:32" (cached in the browser only).
- Empty: mascot empty state with **New project** and a one-line hint that any folder in `/projects` counts.

## Acceptance

- `mkdir /projects/foo` in the terminal → appears in the list on refresh.
- Clone a repo with `compose.yaml` → Start Compose → services shown as running.
- Delete removes the containers and the folder, nothing else.
