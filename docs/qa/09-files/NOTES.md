# 09 — Files: QA notes

## 2026-10-06, slice 1 (real agent in a container): `e2e/09-files.spec.ts` passed

- Browse `/projects/web`; open `compose.yaml` in CodeMirror; edit; Cmd/Ctrl+S saves; `cat` on the server shows the same content.
- A concurrent edit on the server (as a coding agent would) is detected on save: "Reload theirs" / "Overwrite with mine".
- Binary file: size and a download button, no garbage text.
- Upload 50 MB through the UI: sha256 on the server matches; the file belongs to `dev`. Downloading it back gives the same sha256. A folder downloads as `.tar.gz`.
- `/root` is refused (operations run as `dev`).
- Phone: list first, a file opens full width with the editor.
- Fixed on the way: errors thrown inside the Durable Object lost their code across RPC (conflicts showed as 502); the DO now returns replies and the Worker rebuilds the error.
