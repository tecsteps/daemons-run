# daemons.run

Provision a normal Linux VM, give it a browser UI, run coding agents on it, and expose localhost apps securely.

- Your control plane runs in your own Cloudflare account (Workers, D1, passkey sign-in).
- Your servers run in your own Hetzner account, or on any Ubuntu machine you add (vanilla Ubuntu LTS).
- Projects are folders in `/projects`; Docker Compose for project infrastructure.
- No central SaaS hosting of your projects.

Status: early development. The plan lives in [`specs/`](specs/00-overview.md).

## License

MIT
