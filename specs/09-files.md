# 09 — Files

## Goal

Browse and edit files on the VM from the browser for quick looks and small fixes, without a terminal.

## User value

Check a config, fix a typo or drop in an image from your phone. The VM filesystem stays the source of truth.

## Scope

- Tree and list view rooted at `/projects` (navigate up to `/home/daemon` too); hidden files toggle.
- Open a text file in a CodeMirror editor (syntax highlighting, save with Cmd+S, unsaved-changes guard). Images preview inline.
- Create file, create folder, rename, delete (with confirmation), upload (drag and drop, multiple files), download (single file; folder as `.tar.gz`).
- Every operation runs as user `daemon` through the agent's `file.*` messages.
- Limits: editor opens files up to 2 MB; upload and download up to 100 MB per file, streamed in chunks.
- A conflict check on save: if the file changed on disk since opening (for example a coding agent edited it), offer reload or overwrite.

## Out of scope

Git UI, diffs, search across files, permissions editing, a full IDE.

## UX states

- Binary file: show size and a download button, never garbage text.
- Server offline: the browser is read-only with a clear notice, or disabled.

## Acceptance

- Edit `compose.yaml` in the browser, save, `cat` it in the terminal: same content.
- Upload a 50 MB file from a phone; it arrives intact (checksum).
- A coding agent's concurrent edit is detected on save.
