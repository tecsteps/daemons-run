# Contributing

Open an issue before a big change, so we can agree on the approach first. Small fixes: just send a pull request.

## Run it locally

```sh
npm install
npm run dev          # control plane on http://localhost:8787 with a local D1
npm test             # Worker and UI tests
npm run lint
cd agent && go test ./...    # agent and CLI
shellcheck installer/*.sh    # installer
```

The plan lives in [`specs/`](specs/00-overview.md). Read `00-overview.md` and the epic you touch.

## Commits

Short imperative subject (`Control plane: add server list`), body when the why is not obvious.
One logical change per commit. CI must pass.
