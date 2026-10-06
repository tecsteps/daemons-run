# Rules for coding agents

- Read `specs/00-overview.md` first, then the epic you work on. `specs/STATUS.md` says where things stand.
- Keep it small: the smallest thing that works, no abstraction for a second user.
- Reuse the old UI through `specs/ui-reference.md`; never its architecture.
- Every screen must work at 390 px width. Check the phone view before you call a screen done.
- Never commit `.env` or any secret. Credentials for development live in `.env`.
- Run `npm test` (and `go test ./...` in `agent/`) before you commit.
