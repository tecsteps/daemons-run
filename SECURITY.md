# Security

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on
[tecsteps/daemons-run](https://github.com/tecsteps/daemons-run/security/advisories/new).
Do not open a public issue.

In scope: the control plane Worker (`control-plane/`), the apps gateway (`apps-gateway/`), the
agent and CLI (`agent/`) and the installer (`installer/`). Especially: authentication bypass,
cross-origin access from exposed apps to the control plane, credential disclosure, and
anything that lets someone other than the owner reach a server.

Out of scope: your Cloudflare or Hetzner account configuration, and apps you expose yourself.

We aim to answer within a week.
