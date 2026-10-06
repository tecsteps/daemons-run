import { Hono, type Context } from 'hono';
import { now, randomId, randomToken, sha256 } from './crypto';
import type { Env, HonoEnv } from './env';
import { HetznerProvider } from './providers/hetzner';
import { ProviderError, type Provider } from './providers/provider';
import { vault } from './key-vault';
import { AgentError, serverStub } from './server-connection';
import cloudInitTemplate from './generated/cloud-init.yaml.tmpl';

export const AGENTS = ['claude', 'codex', 'opencode'] as const;
const ENROLL_TTL = 3600 * 1000;
export const SERVER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export type ServerRow = {
  id: string;
  name: string;
  provider: string | null;
  provider_server_id: string | null;
  status: 'creating' | 'installing' | 'online' | 'failed';
  location: string | null;
  size: string | null;
  price_monthly: string | null;
  agents: string;
  ipv4: string | null;
  ipv6: string | null;
  error: string | null;
  install_step: string | null;
  install_status: string | null;
  install_log: string | null;
  install_updated_at: number | null;
  agent_version: string | null;
  hostname: string | null;
  os: string | null;
  arch: string | null;
  cpus: number | null;
  memory_bytes: number | null;
  disk_bytes: number | null;
  connected: number;
  last_seen_at: number | null;
  created_at: number;
};

// --- provider credentials ---------------------------------------------------------------

export async function providerFor(env: Env, id = 'hetzner'): Promise<Provider | null> {
  const row = await env.DB.prepare('SELECT credentials, key_id FROM providers WHERE id = ?').bind(id).first<{ credentials: string; key_id: string }>();
  if (!row) return null;
  const token = await vault(env).decrypt(row.key_id, row.credentials);
  if (!token) return null;
  return new HetznerProvider(token, env.HETZNER_API_BASE);
}

export const providerRoutes = new Hono<HonoEnv>();

providerRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare('SELECT id, key_id, credentials, created_at FROM providers').all<{
    id: string;
    key_id: string;
    credentials: string;
    created_at: number;
  }>();
  const providers = await Promise.all(
    rows.results.map(async (r) => ({
      id: r.id,
      label: 'Hetzner',
      createdAt: r.created_at,
      // A lost or rotated key means the stored token is unreadable: ask for it again.
      needsCredentials: (await vault(c.env).decrypt(r.key_id, r.credentials)) === null,
    })),
  );
  return c.json({ providers });
});

providerRoutes.put('/hetzner', async (c) => {
  const { token } = await c.req.json<{ token: string }>();
  const clean = (token ?? '').trim();
  if (!clean) return c.json({ error: 'Paste your Hetzner API token.' }, 400);
  try {
    await new HetznerProvider(clean, c.env.HETZNER_API_BASE).validateCredentials();
  } catch (error) {
    const message = error instanceof ProviderError ? error.message : 'Hetzner could not be reached.';
    return c.json({ error: message }, 400);
  }
  const { keyId, ciphertext } = await vault(c.env).encrypt(clean);
  await c.env.DB.prepare(
    'INSERT INTO providers (id, credentials, key_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET credentials = excluded.credentials, key_id = excluded.key_id, created_at = excluded.created_at',
  )
    .bind('hetzner', ciphertext, keyId, now())
    .run();
  return c.json({ ok: true });
});

providerRoutes.delete('/hetzner', async (c) => {
  await c.env.DB.prepare('DELETE FROM providers WHERE id = ?').bind('hetzner').run();
  return c.json({ ok: true });
});

providerRoutes.get('/hetzner/options', async (c) => {
  const provider = await providerFor(c.env);
  if (!provider) return c.json({ error: 'Connect Hetzner first.', code: 'no_provider' }, 409);
  try {
    return c.json(await provider.listOptions());
  } catch (error) {
    return c.json({ error: error instanceof ProviderError ? error.message : 'Hetzner could not be reached.' }, 502);
  }
});

// --- settings ---------------------------------------------------------------------------

export const settingsRoutes = new Hono<HonoEnv>();

settingsRoutes.get('/ssh-key', async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'ssh_public_key'").first<{ value: string }>();
  return c.json({ publicKey: row?.value ?? null });
});

settingsRoutes.put('/ssh-key', async (c) => {
  const { publicKey } = await c.req.json<{ publicKey: string | null }>();
  const clean = (publicKey ?? '').trim();
  if (!clean) {
    await c.env.DB.prepare("DELETE FROM settings WHERE key = 'ssh_public_key'").run();
    return c.json({ ok: true });
  }
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/=]+( .*)?$/.test(clean)) {
    return c.json({ error: 'That does not look like an OpenSSH public key (it starts with ssh-ed25519 or ssh-rsa).' }, 400);
  }
  await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('ssh_public_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(clean)
    .run();
  return c.json({ ok: true });
});

// --- servers ----------------------------------------------------------------------------

export function userData(origin: string, token: string, agents: string[]): string {
  return cloudInitTemplate
    .replaceAll('__CONTROL_PLANE_URL__', origin)
    .replaceAll('__ENROLL_TOKEN__', token)
    .replaceAll('__AGENTS__', agents.join(' '));
}

export function installCommand(origin: string, token: string, agents: string[]): string {
  return `curl -fsSL ${origin}/install.sh | sudo DAEMONS_TOKEN=${token} DAEMONS_AGENTS="${agents.join(' ')}" sh`;
}

async function newEnrollmentToken(env: Env, serverId: string): Promise<string> {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO enrollment_tokens (token_hash, server_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), serverId, now() + ENROLL_TTL)
    .run();
  return token;
}

function controlPlaneLabel(origin: string): string {
  return new URL(origin).hostname.replace(/[^a-z0-9-]/gi, '-').slice(0, 63);
}

export function labelsFor(origin: string, extra: Record<string, string> = {}): Record<string, string> {
  return { 'managed-by': 'daemons', 'daemons-control-plane': controlPlaneLabel(origin), ...extra };
}

async function live(env: Env, row: ServerRow) {
  let connected = false;
  let lastHeartbeat: number | null = null;
  if (row.status === 'online') {
    try {
      const status = await serverStub(env, row.id).status();
      connected = status.connected;
      lastHeartbeat = status.lastHeartbeat;
    } catch {}
  }
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    providerServerId: row.provider_server_id,
    status: row.status === 'online' ? (connected ? 'online' : 'offline') : row.status,
    location: row.location,
    size: row.size,
    priceMonthly: row.price_monthly,
    agents: JSON.parse(row.agents) as string[],
    ipv4: row.ipv4,
    ipv6: row.ipv6,
    error: row.error,
    install: { step: row.install_step, status: row.install_status, log: row.install_log, updatedAt: row.install_updated_at },
    agentVersion: row.agent_version,
    hostname: row.hostname,
    os: row.os,
    arch: row.arch,
    cpus: row.cpus,
    memoryBytes: row.memory_bytes,
    diskBytes: row.disk_bytes,
    lastSeenAt: connected ? lastHeartbeat : row.last_seen_at,
    createdAt: row.created_at,
  };
}

export type ServerView = Awaited<ReturnType<typeof live>>;

/** Brings a server that is still being created up to date with the provider (04). */
async function reconcile(env: Env, row: ServerRow): Promise<ServerRow> {
  if (row.provider !== 'hetzner' || row.status === 'online' || row.status === 'failed') return row;
  const provider = await providerFor(env);
  if (!provider) return row;
  try {
    let remote = row.provider_server_id ? await provider.getServer(row.provider_server_id) : null;
    if (!row.provider_server_id && now() - row.created_at > 60_000) {
      // The create call may have timed out after Hetzner accepted it.
      remote = await provider.findServerByName(row.name, { 'managed-by': 'daemons' });
      if (remote) {
        await env.DB.prepare('UPDATE servers SET provider_server_id = ? WHERE id = ?').bind(remote.id, row.id).run();
        row.provider_server_id = remote.id;
      }
    }
    if (row.provider_server_id && !remote) {
      await env.DB.prepare("UPDATE servers SET status = 'failed', error = ? WHERE id = ?")
        .bind('The server no longer exists at Hetzner.', row.id)
        .run();
      return { ...row, status: 'failed', error: 'The server no longer exists at Hetzner.' };
    }
    if (remote && (remote.ipv4 !== row.ipv4 || remote.ipv6 !== row.ipv6)) {
      await env.DB.prepare('UPDATE servers SET ipv4 = ?, ipv6 = ? WHERE id = ?').bind(remote.ipv4, remote.ipv6, row.id).run();
      row.ipv4 = remote.ipv4;
      row.ipv6 = remote.ipv6;
    }
  } catch {}
  return row;
}

export const serverRoutes = new Hono<HonoEnv>();

async function getRow(env: Env, id: string) {
  return env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(id).first<ServerRow>();
}

serverRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM servers ORDER BY created_at').all<ServerRow>();
  const servers = await Promise.all(rows.results.map(async (r) => live(c.env, await reconcile(c.env, r))));
  return c.json({ servers });
});

serverRoutes.get('/:id', async (c) => {
  const row = await getRow(c.env, c.req.param('id'));
  if (!row) return c.json({ error: 'Server not found.' }, 404);
  return c.json({ server: await live(c.env, await reconcile(c.env, row)) });
});

function originOf(c: Context<HonoEnv>) {
  return new URL(c.req.url).origin;
}

function cleanAgents(agents: unknown): string[] | null {
  if (!Array.isArray(agents)) return null;
  const list = AGENTS.filter((a) => agents.includes(a));
  return list.length ? list : null;
}

serverRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name: string; location: string; size: string; agents: string[] }>();
  const name = (body.name ?? '').trim().toLowerCase();
  if (!SERVER_NAME.test(name)) {
    return c.json({ error: 'Use a-z, 0-9 and dashes for the name, up to 32 characters.', field: 'name' }, 400);
  }
  const agents = cleanAgents(body.agents);
  if (!agents) return c.json({ error: 'Pick at least one coding agent.', field: 'agents' }, 400);
  const provider = await providerFor(c.env);
  if (!provider) return c.json({ error: 'Connect Hetzner first.', code: 'no_provider' }, 409);
  if (await c.env.DB.prepare('SELECT 1 FROM servers WHERE name = ?').bind(name).first()) {
    return c.json({ error: `You already have a server named ${name}.`, field: 'name' }, 409);
  }
  let price: string | null = null;
  try {
    const options = await provider.listOptions();
    const size = options.sizes.find((s) => s.name === body.size);
    if (!size) return c.json({ error: 'That server type does not exist.', field: 'size' }, 400);
    if (!size.availableIn.includes(body.location)) {
      return c.json({ error: `${body.size} is not available in ${body.location}. Pick another type or location.`, field: 'size' }, 400);
    }
    price = size.prices.find((p) => p.location === body.location)?.monthly ?? null;
  } catch (error) {
    return c.json({ error: error instanceof ProviderError ? error.message : 'Hetzner could not be reached.' }, 502);
  }

  // Durable creation: the row exists before we pay for anything (04).
  const id = randomId('srv');
  await c.env.DB.prepare(
    "INSERT INTO servers (id, name, provider, status, location, size, price_monthly, agents, created_at) VALUES (?, ?, 'hetzner', 'creating', ?, ?, ?, ?, ?)",
  )
    .bind(id, name, body.location, body.size, price, JSON.stringify(agents), now())
    .run();
  const token = await newEnrollmentToken(c.env, id);
  const sshKey = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'ssh_public_key'").first<{ value: string }>();
  try {
    const created = await provider.createServer({
      name,
      location: body.location,
      size: body.size,
      userData: userData(originOf(c), token, agents),
      sshPublicKey: sshKey?.value ?? null,
      labels: labelsFor(originOf(c), { 'daemons-server': id.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 63) }),
    });
    await c.env.DB.prepare('UPDATE servers SET provider_server_id = ?, ipv4 = ?, ipv6 = ? WHERE id = ?')
      .bind(created.id, created.ipv4, created.ipv6, id)
      .run();
  } catch (error) {
    if (error instanceof ProviderError && error.code !== 'timeout') {
      // Hetzner refused: nothing was bought, so forget the row and let the user adjust the form.
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM servers WHERE id = ?').bind(id),
        c.env.DB.prepare('DELETE FROM enrollment_tokens WHERE server_id = ?').bind(id),
      ]);
      return c.json({ error: `Hetzner: ${error.message}` }, 400);
    }
    // Timeout: the server may exist. Reconcile finds it by name; never buy a second one.
  }
  return c.json({ server: await live(c.env, (await getRow(c.env, id))!) }, 201);
});

serverRoutes.post('/existing', async (c) => {
  const body = await c.req.json<{ name: string; agents: string[] }>();
  const name = (body.name ?? '').trim().toLowerCase();
  if (!SERVER_NAME.test(name)) {
    return c.json({ error: 'Use a-z, 0-9 and dashes for the name, up to 32 characters.', field: 'name' }, 400);
  }
  const agents = cleanAgents(body.agents);
  if (!agents) return c.json({ error: 'Pick at least one coding agent.', field: 'agents' }, 400);
  if (await c.env.DB.prepare('SELECT 1 FROM servers WHERE name = ?').bind(name).first()) {
    return c.json({ error: `You already have a server named ${name}.`, field: 'name' }, 409);
  }
  const id = randomId('srv');
  await c.env.DB.prepare("INSERT INTO servers (id, name, provider, status, agents, created_at) VALUES (?, ?, NULL, 'installing', ?, ?)")
    .bind(id, name, JSON.stringify(agents), now())
    .run();
  const token = await newEnrollmentToken(c.env, id);
  return c.json({ server: await live(c.env, (await getRow(c.env, id))!), command: installCommand(originOf(c), token, agents) }, 201);
});

serverRoutes.post('/:id/retry', async (c) => {
  const row = await getRow(c.env, c.req.param('id'));
  if (!row) return c.json({ error: 'Server not found.' }, 404);
  const agents = JSON.parse(row.agents) as string[];
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE agent_credentials SET revoked_at = ? WHERE server_id = ? AND revoked_at IS NULL').bind(now(), row.id),
    c.env.DB.prepare(
      "UPDATE servers SET status = 'installing', error = NULL, install_step = NULL, install_status = NULL, install_log = NULL, install_updated_at = ?, connected = 0 WHERE id = ?",
    ).bind(now(), row.id),
  ]);
  await serverStub(c.env, row.id).disconnectAgent('Reinstalling.');
  if (row.provider === null) {
    const token = await newEnrollmentToken(c.env, row.id);
    return c.json({ command: installCommand(originOf(c), token, agents) });
  }
  const provider = await providerFor(c.env);
  if (!provider || !row.provider_server_id) return c.json({ error: 'Connect Hetzner first.' }, 409);
  // The rebuild reruns the original user data, so its enrollment token is armed again.
  await c.env.DB.prepare('UPDATE enrollment_tokens SET used_at = NULL, expires_at = ? WHERE server_id = ?')
    .bind(now() + ENROLL_TTL, row.id)
    .run();
  try {
    await provider.rebuildServer(row.provider_server_id);
  } catch (error) {
    return c.json({ error: error instanceof ProviderError ? `Hetzner: ${error.message}` : 'Hetzner could not be reached.' }, 502);
  }
  return c.json({ ok: true });
});

serverRoutes.delete('/:id', async (c) => {
  const row = await getRow(c.env, c.req.param('id'));
  if (!row) return c.json({ error: 'Server not found.' }, 404);
  const { confirm } = await c.req.json<{ confirm: string }>().catch(() => ({ confirm: '' }));
  if (confirm !== row.name) return c.json({ error: `Type ${row.name} to confirm.` }, 400);
  if (row.provider === 'hetzner' && row.provider_server_id) {
    const provider = await providerFor(c.env);
    if (!provider) return c.json({ error: 'Connect Hetzner again first, so the server can be deleted there too.' }, 409);
    try {
      await provider.deleteServer(row.provider_server_id);
    } catch (error) {
      return c.json({ error: error instanceof ProviderError ? `Hetzner: ${error.message}` : 'Hetzner could not be reached.' }, 502);
    }
  }
  await serverStub(c.env, row.id).disconnectAgent('Server removed.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM servers WHERE id = ?').bind(row.id),
    c.env.DB.prepare('DELETE FROM agent_credentials WHERE server_id = ?').bind(row.id),
    c.env.DB.prepare('DELETE FROM enrollment_tokens WHERE server_id = ?').bind(row.id),
    c.env.DB.prepare('DELETE FROM apps WHERE server_id = ?').bind(row.id),
  ]);
  return c.json({ ok: true });
});

// --- live data from the agent -----------------------------------------------------------

export async function agentCall(c: Context<HonoEnv>, type: string, params: Record<string, unknown> = {}, timeoutMs?: number) {
  const row = await getRow(c.env, c.req.param('id')!);
  if (!row) return c.json({ error: 'Server not found.' }, 404);
  try {
    const reply = (await serverStub(c.env, row.id).request(type, params, timeoutMs)) as Record<string, unknown>;
    const { id: _id, ok: _ok, ...result } = reply;
    return c.json(result);
  } catch (error) {
    const code = error instanceof AgentError ? error.code : 'internal';
    const message = error instanceof Error ? error.message : 'The server reported an error.';
    const status = code === 'offline' ? 503 : code === 'timeout' ? 504 : code === 'not_found' ? 404 : code === 'exists' || code === 'conflict' ? 409 : code === 'bad_request' || code === 'too_large' ? 400 : 502;
    return c.json({ error: message, code }, status);
  }
}

serverRoutes.get('/:id/info', (c) => agentCall(c, 'system.info'));
serverRoutes.get('/:id/ports', (c) => agentCall(c, 'ports.list'));
serverRoutes.get('/:id/terminals', (c) => agentCall(c, 'terminal.list'));
serverRoutes.delete('/:id/terminals/:session', (c) => agentCall(c, 'terminal.kill', { session: c.req.param('session') }));
serverRoutes.patch('/:id/terminals/:session', async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  return agentCall(c, 'terminal.rename', { session: c.req.param('session'), name });
});

serverRoutes.get('/:id/terminals/:session/ws', async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'Expected a WebSocket.' }, 426);
  const session = c.req.param('session');
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(session)) return c.json({ error: 'Bad session name.' }, 400);
  const row = await getRow(c.env, c.req.param('id'));
  if (!row) return c.json({ error: 'Server not found.' }, 404);
  const url = new URL(c.req.url);
  const target = new URL('https://do/terminal');
  target.searchParams.set('session', session);
  for (const key of ['cols', 'rows', 'cwd', 'command']) {
    const value = url.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Daemons-Session', c.get('sessionId'));
  return serverStub(c.env, row.id).fetch(new Request(target, { headers }));
});
