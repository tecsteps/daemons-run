import { Hono } from 'hono';
import { bearer, now, randomToken, sha256 } from './crypto';
import type { HonoEnv } from './env';
import { serverStub } from './server-connection';
import installScript from './generated/install.sh';

/** Endpoints the VM calls (agent/PROTOCOL.md). None of them use the owner session. */
export const agentRoutes = new Hono<HonoEnv>();

const LOG_LIMIT = 16_000;

export const installRoute = new Hono<HonoEnv>();

installRoute.get('/install.sh', (c) => {
  const script = installScript
    .replaceAll('__CONTROL_PLANE_URL__', new URL(c.req.url).origin)
    .replaceAll('__AGENT_RELEASE__', c.env.AGENT_RELEASE);
  return c.body(script, 200, { 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Cache-Control': 'no-store' });
});

agentRoutes.post('/progress', async (c) => {
  const token = bearer(c.req.raw);
  if (!token) return c.json({ error: 'Missing token.' }, 401);
  // Valid while unused, and for an hour after enrollment so late failures still show.
  const row = await c.env.DB.prepare('SELECT server_id, expires_at, used_at FROM enrollment_tokens WHERE token_hash = ?')
    .bind(await sha256(token))
    .first<{ server_id: string; expires_at: number; used_at: number | null }>();
  if (!row || (row.used_at === null && row.expires_at < now()) || (row.used_at !== null && row.used_at + 3600_000 < now())) {
    return c.json({ error: 'Invalid token.' }, 401);
  }
  const body = await c.req.json<{ step?: string; status?: string; log?: string }>().catch(() => ({}) as Record<string, string>);
  const status = ['running', 'done', 'failed'].includes(body.status ?? '') ? body.status! : 'running';
  await c.env.DB.prepare(
    `UPDATE servers SET install_step = ?, install_status = ?, install_log = ?, install_updated_at = ?,
       status = CASE WHEN status = 'creating' THEN 'installing' ELSE status END,
       error = CASE WHEN ? = 'failed' THEN ? ELSE error END
     WHERE id = ?`,
  )
    .bind(
      String(body.step ?? '').slice(0, 64),
      status,
      String(body.log ?? '').slice(-LOG_LIMIT),
      now(),
      status,
      `Installation failed at step ${String(body.step ?? '').slice(0, 64)}.`,
      row.server_id,
    )
    .run();
  return c.body(null, 204);
});

agentRoutes.post('/enroll', async (c) => {
  const token = bearer(c.req.raw);
  if (!token) return c.json({ error: 'Missing token.' }, 401);
  const tokenHash = await sha256(token);
  const used = await c.env.DB.prepare(
    'UPDATE enrollment_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING server_id',
  )
    .bind(now(), tokenHash, now())
    .first<{ server_id: string }>();
  if (!used) return c.json({ error: 'This enrollment token is invalid, used or expired. Create a new install command.' }, 401);
  const server = await c.env.DB.prepare('SELECT id, name FROM servers WHERE id = ?').bind(used.server_id).first<{ id: string; name: string }>();
  if (!server) return c.json({ error: 'This server was removed.' }, 404);
  const credential = randomToken();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE agent_credentials SET revoked_at = ? WHERE server_id = ? AND revoked_at IS NULL').bind(now(), server.id),
    c.env.DB.prepare('INSERT INTO agent_credentials (credential_hash, server_id, created_at) VALUES (?, ?, ?)').bind(
      await sha256(credential),
      server.id,
      now(),
    ),
  ]);
  return c.json({ server_id: server.id, name: server.name, credential });
});

agentRoutes.get('/connect', async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'Expected a WebSocket.' }, 426);
  const protocol = c.req.header('X-Daemons-Protocol');
  if (protocol && protocol !== '1') return c.json({ error: 'Protocol version not supported.' }, 426);
  const credential = bearer(c.req.raw);
  if (!credential) return c.json({ error: 'Missing credential.' }, 401);
  const row = await c.env.DB.prepare('SELECT server_id FROM agent_credentials WHERE credential_hash = ? AND revoked_at IS NULL')
    .bind(await sha256(credential))
    .first<{ server_id: string }>();
  if (!row) return c.json({ error: 'Credential revoked.' }, 401);
  const headers = new Headers(c.req.raw.headers);
  headers.delete('Authorization');
  headers.set('X-Daemons-Server-Id', row.server_id);
  headers.set('X-Daemons-Origin', new URL(c.req.url).origin);
  return serverStub(c.env, row.server_id).fetch(new Request('https://do/agent', { headers }));
});
