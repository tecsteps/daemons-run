import { Hono } from 'hono';
import { now, randomToken, sha256 } from './crypto';
import type { Env, HonoEnv } from './env';
import { appsOrigin, controlPlaneOriginFromApps } from './origins';
import { APP_NAME, exposeApp, listApps, type AppRow } from './apps';
import { AgentError, serverStub } from './server-connection';
import { currentSession } from './auth';

export const APP_COOKIE = '__daemons_app';
const TICKET_PARAM = '__daemons_ticket';
const TICKET_TTL = 60_000;
const APP_SESSION_TTL = 12 * 3600 * 1000;

// --- owner API: /api/apps ------------------------------------------------------------------

export const appRoutes = new Hono<HonoEnv>();

appRoutes.get('/', async (c) => {
  const origin = appsOrigin(c.env, c.req.url);
  const apps = await listApps(c.env);
  const servers = await c.env.DB.prepare('SELECT id, name FROM servers').all<{ id: string; name: string }>();
  const names = new Map(servers.results.map((s) => [s.id, s.name]));
  return c.json({
    appsOrigin: origin,
    apps: apps.map((a) => ({
      name: a.name,
      port: a.port,
      cwd: a.cwd,
      public: !!a.public,
      serverId: a.server_id,
      serverName: names.get(a.server_id) ?? null,
      url: `${origin}/${a.name}/`,
      createdAt: a.created_at,
    })),
  });
});

appRoutes.post('/', async (c) => {
  const body = await c.req.json<{ serverId: string; port: number; name: string; cwd?: string; public?: boolean }>();
  const server = await c.env.DB.prepare('SELECT id FROM servers WHERE id = ?').bind(body.serverId).first();
  if (!server) return c.json({ error: 'Server not found.' }, 404);
  try {
    const app = await exposeApp(c.env, body.serverId, { name: body.name ?? '', port: Number(body.port), cwd: body.cwd ?? null, public: !!body.public });
    return c.json({ name: app.name, url: `${appsOrigin(c.env, c.req.url)}/${app.name}/` }, 201);
  } catch (error) {
    if (error instanceof AgentError) return c.json({ error: error.message }, error.code === 'exists' ? 409 : 400);
    throw error;
  }
});

appRoutes.patch('/:name', async (c) => {
  const { public: isPublic } = await c.req.json<{ public: boolean }>();
  const result = await c.env.DB.prepare('UPDATE apps SET public = ? WHERE name = ?').bind(isPublic ? 1 : 0, c.req.param('name')).run();
  if (result.meta.changes === 0) return c.json({ error: 'App not found.' }, 404);
  return c.json({ ok: true });
});

appRoutes.delete('/:name', async (c) => {
  await c.env.DB.prepare('DELETE FROM apps WHERE name = ?').bind(c.req.param('name')).run();
  return c.json({ ok: true });
});

/**
 * GET /api/apps/ticket?return=<app url>: a signed-in owner gets a single-use ticket for the
 * apps origin. Signed-out visitors are sent to sign-in first.
 */
export const ticketRoute = new Hono<HonoEnv>();

ticketRoute.get('/api/apps/ticket', async (c) => {
  const returnUrl = c.req.query('return') ?? '';
  const origin = appsOrigin(c.env, c.req.url);
  let target: URL;
  try {
    target = new URL(returnUrl);
  } catch {
    return c.text('Bad return address.', 400);
  }
  if (target.origin !== origin) return c.text('Bad return address.', 400);
  if (!(await currentSession(c))) {
    const next = `/api/apps/ticket?return=${encodeURIComponent(returnUrl)}`;
    return c.redirect(`/login?next=${encodeURIComponent(next)}`, 302);
  }
  const ticket = randomToken();
  await c.env.DB.prepare('INSERT INTO app_tickets (token_hash, kind, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(ticket), 'ticket', now() + TICKET_TTL)
    .run();
  target.searchParams.set(TICKET_PARAM, ticket);
  return c.redirect(target.toString(), 302);
});

// --- traffic from the apps gateway --------------------------------------------------------

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · daemons.run</title><style>
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#0b0e0d;color:#f5f1e8;font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}
main{max-width:32rem;padding:2rem 1.25rem}.mark{font:600 14px ui-monospace,Menlo,monospace;color:#c4ff18;letter-spacing:.04em}
h1{font-size:1.5rem;line-height:1.25;margin:.75rem 0}p{color:#aab2ae;margin:.5rem 0}code{font:14px ui-monospace,Menlo,monospace;color:#f5f1e8;background:#151917;padding:.1rem .35rem;border-radius:.3rem}
</style></head><body><main><div class="mark">&gt; &lt; daemons.run</div><h1>${title}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

async function validAppSession(env: Env, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const row = await env.DB.prepare("SELECT expires_at FROM app_tickets WHERE token_hash = ? AND kind = 'session'")
    .bind(await sha256(token))
    .first<{ expires_at: number }>();
  return !!row && row.expires_at > now();
}

function stripAppCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const kept = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${APP_COOKIE}=`));
  return kept.length ? kept.join('; ') : null;
}

/** Handles one request that arrived through the apps gateway (08). */
export async function handleAppRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const [, first] = url.pathname.split('/');
  if (!first) return page(200, 'App links', '<p>Apps exposed on your servers appear at <code>/&lt;name&gt;/</code> on this address.</p>');
  const name = decodeURIComponent(first).toLowerCase();
  if (!APP_NAME.test(name)) return page(404, 'No such app', '<p>Check the link, or list your apps with <code>daemons apps</code>.</p>');
  if (url.pathname === `/${first}`) return Response.redirect(`${origin}/${first}/${url.search}`, 301);

  const app = await env.DB.prepare('SELECT * FROM apps WHERE name = ?').bind(name).first<AppRow>();
  if (!app) {
    return page(404, `${escape(name)} is not exposed`, `<p>Run <code>daemons expose &lt;port&gt; --name ${escape(name)}</code> on your server to publish it here.</p>`);
  }

  // Private apps: owner session on the control plane → single-use ticket → app cookie here.
  if (!app.public) {
    const ticket = url.searchParams.get(TICKET_PARAM);
    if (ticket) {
      const used = await env.DB.prepare(
        "UPDATE app_tickets SET used_at = ? WHERE token_hash = ? AND kind = 'ticket' AND used_at IS NULL AND expires_at > ? RETURNING token_hash",
      )
        .bind(now(), await sha256(ticket), now())
        .first();
      url.searchParams.delete(TICKET_PARAM);
      if (!used) return Response.redirect(url.toString(), 302);
      const session = randomToken();
      await env.DB.prepare('INSERT INTO app_tickets (token_hash, kind, expires_at) VALUES (?, ?, ?)')
        .bind(await sha256(session), 'session', now() + APP_SESSION_TTL)
        .run();
      return new Response(null, {
        status: 302,
        headers: {
          Location: url.toString(),
          'Set-Cookie': `${APP_COOKIE}=${session}; Path=/; Max-Age=${APP_SESSION_TTL / 1000}; HttpOnly; Secure; SameSite=Lax`,
          'Cache-Control': 'no-store',
        },
      });
    }
    const cookie = /(?:^|;\s*)__daemons_app=([^;]+)/.exec(request.headers.get('Cookie') ?? '')?.[1];
    if (!(await validAppSession(env, cookie))) {
      if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket' || request.method !== 'GET') {
        return new Response('Sign in first.', { status: 401 });
      }
      const cp = controlPlaneOriginFromApps(env, request.url);
      return Response.redirect(`${cp}/api/apps/ticket?return=${encodeURIComponent(url.toString())}`, 302);
    }
  }

  const headers = new Headers(request.headers);
  const cookies = stripAppCookie(headers.get('Cookie'));
  if (cookies) headers.set('Cookie', cookies);
  else headers.delete('Cookie');
  headers.set('X-Forwarded-Prefix', `/${name}`);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', 'https');
  headers.set('X-Daemons-App-Port', String(app.port));
  headers.set('X-Daemons-Public-Base', `${origin}/${name}`);
  headers.set('X-Daemons-Path', `${url.pathname}${url.search}`);
  const response = await serverStub(env, app.server_id).fetch(
    new Request('https://do/app', { method: request.method, headers, body: request.body, redirect: 'manual' }),
  );
  const error = response.headers.get('X-Daemons-Error');
  if (!error) return response;
  if (error === 'not_listening') {
    return page(502, `${escape(name)} is not running`, `<p>${escape(name)} is exposed, but nothing is listening on port ${app.port}. Start it in a terminal on your server, then reload.</p>`);
  }
  if (error === 'offline') {
    const server = await env.DB.prepare('SELECT name, last_seen_at FROM servers WHERE id = ?').bind(app.server_id).first<{ name: string; last_seen_at: number | null }>();
    const seen = server?.last_seen_at ? ` It was last seen ${new Date(server.last_seen_at).toUTCString()}.` : '';
    return page(503, 'The server is offline', `<p>${escape(server?.name ?? 'The server')} is not connected right now.${seen}</p>`);
  }
  return page(502, 'The app could not be reached', `<p>${escape(await response.text())}</p>`);
}
