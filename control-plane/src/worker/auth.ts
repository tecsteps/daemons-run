import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { base64url, constantTimeEqual, fromBase64url, now, randomId, randomToken, sha256 } from './crypto';
import type { Env, HonoEnv } from './env';

export const SESSION_COOKIE = '__Host-daemons_session';
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const CHALLENGE_TTL = 5 * 60 * 1000;
const SETUP_MAX_FAILURES = 5;
const SETUP_WINDOW = 15 * 60 * 1000;

type SetupState = {
  user_id: string;
  consumed_code_hash: string | null;
  failed_attempts: number;
  window_started_at: number;
};

async function setupState(db: D1Database): Promise<SetupState> {
  await db
    .prepare('INSERT OR IGNORE INTO setup_state (id, user_id) VALUES (1, ?)')
    .bind(randomToken(16))
    .run();
  return (await db.prepare('SELECT * FROM setup_state WHERE id = 1').first<SetupState>())!;
}

/** Setup is open while no passkey was registered with the current SETUP_CODE. */
export async function isSetupOpen(env: Env): Promise<boolean> {
  if (!env.SETUP_CODE) return false;
  const state = await setupState(env.DB);
  return state.consumed_code_hash !== (await sha256(env.SETUP_CODE));
}

function rpFor(c: Context) {
  const url = new URL(c.req.url);
  return { rpID: url.hostname, origin: url.origin };
}

async function storeChallenge(db: D1Database, challenge: string, kind: string) {
  await db
    .prepare('DELETE FROM auth_challenges WHERE expires_at < ?')
    .bind(now())
    .run();
  await db
    .prepare('INSERT INTO auth_challenges (challenge, kind, expires_at) VALUES (?, ?, ?)')
    .bind(challenge, kind, now() + CHALLENGE_TTL)
    .run();
}

/** Single use: the challenge is deleted whether or not it is still valid. */
async function takeChallenge(db: D1Database, challenge: string, kind: string): Promise<boolean> {
  const row = await db
    .prepare('DELETE FROM auth_challenges WHERE challenge = ? AND kind = ? RETURNING expires_at')
    .bind(challenge, kind)
    .first<{ expires_at: number }>();
  return !!row && row.expires_at > now();
}

function challengeOf(response: { response: { clientDataJSON: string } }): string {
  const json = JSON.parse(new TextDecoder().decode(fromBase64url(response.response.clientDataJSON)));
  return json.challenge as string;
}

async function registrationOptions(c: Context<HonoEnv>, kind: string) {
  const state = await setupState(c.env.DB);
  const existing = await c.env.DB.prepare('SELECT id, transports FROM passkeys').all<{ id: string; transports: string | null }>();
  const options = await generateRegistrationOptions({
    rpName: 'daemons.run',
    rpID: rpFor(c).rpID,
    userName: 'owner',
    userDisplayName: 'Owner',
    userID: fromBase64url(state.user_id),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials:
      kind === 'setup'
        ? []
        : existing.results.map((p) => ({
            id: p.id,
            transports: p.transports ? (JSON.parse(p.transports) as AuthenticatorTransportFuture[]) : undefined,
          })),
  });
  await storeChallenge(c.env.DB, options.challenge, kind);
  return options;
}

async function verifyRegistration(c: Context<HonoEnv>, response: RegistrationResponseJSON, kind: string) {
  const challenge = challengeOf(response);
  if (!(await takeChallenge(c.env.DB, challenge, kind))) return null;
  const { rpID, origin } = rpFor(c);
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!result.verified) return null;
    const cred = result.registrationInfo.credential;
    return {
      id: cred.id,
      publicKey: base64url(cred.publicKey),
      counter: cred.counter,
      transports: JSON.stringify(cred.transports ?? []),
    };
  } catch {
    return null;
  }
}

export function passkeyName(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '';
  return browser ? `${device} · ${browser}` : device;
}

async function createSession(c: Context<HonoEnv>, passkeyId: string) {
  const token = randomToken();
  const id = randomId('ses');
  const t = now();
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, token_hash, passkey_id, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, await sha256(token), passkeyId, c.req.header('User-Agent') ?? null, t, t, t + SESSION_TTL)
    .run();
  setSessionCookie(c, token);
}

function setSessionCookie(c: Context<HonoEnv>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: SESSION_TTL / 1000,
  });
}

/** Resolves the owner session from the cookie; slides the expiry at most once an hour. */
export async function currentSession(c: Context<HonoEnv>): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare('SELECT id, expires_at, last_seen_at FROM sessions WHERE token_hash = ?')
    .bind(await sha256(token))
    .first<{ id: string; expires_at: number; last_seen_at: number }>();
  if (!row || row.expires_at < now()) return null;
  if (now() - row.last_seen_at > 3600 * 1000) {
    await c.env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .bind(now(), now() + SESSION_TTL, row.id)
      .run();
    setSessionCookie(c, token);
  }
  return row.id;
}

/** Rejects state-changing requests and WebSocket upgrades from any other origin. */
export const requireSameOrigin: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const isUpgrade = c.req.header('Upgrade')?.toLowerCase() === 'websocket';
  if (isUpgrade || !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    if (c.req.header('Origin') !== new URL(c.req.url).origin) {
      return c.json({ error: 'Cross-origin request rejected.' }, 403);
    }
  }
  await next();
};

export const requireSession: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const sessionId = await currentSession(c);
  if (!sessionId) return c.json({ error: 'Sign in first.' }, 401);
  c.set('sessionId', sessionId);
  await next();
};

export const authRoutes = new Hono<HonoEnv>();

authRoutes.get('/me', async (c) => {
  const sessionId = await currentSession(c);
  return c.json({
    authenticated: !!sessionId,
    setupOpen: await isSetupOpen(c.env),
    setupCodeConfigured: !!c.env.SETUP_CODE,
  });
});

// --- Setup (setup code) -----------------------------------------------------------------

async function checkSetupCode(c: Context<HonoEnv>, code: string): Promise<Response | null> {
  if (!(await isSetupOpen(c.env))) return c.json({ error: 'Setup is closed. Sign in with your passkey.', code: 'closed' }, 409);
  const state = await setupState(c.env.DB);
  const t = now();
  const windowOpen = t - state.window_started_at < SETUP_WINDOW;
  const failures = windowOpen ? state.failed_attempts : 0;
  if (failures >= SETUP_MAX_FAILURES) {
    const retryAt = state.window_started_at + SETUP_WINDOW;
    return c.json({ error: 'Too many wrong codes.', code: 'locked', retryAt }, 429);
  }
  if (await constantTimeEqual(code.trim(), c.env.SETUP_CODE!)) return null;
  await c.env.DB.prepare('UPDATE setup_state SET failed_attempts = ?, window_started_at = ? WHERE id = 1')
    .bind(failures + 1, windowOpen ? state.window_started_at : t)
    .run();
  const left = SETUP_MAX_FAILURES - failures - 1;
  return c.json({ error: 'That setup code is not right.', code: 'wrong_code', attemptsLeft: left }, 403);
}

authRoutes.post('/setup/options', requireSameOrigin, async (c) => {
  const { code } = await c.req.json<{ code: string }>();
  const rejected = await checkSetupCode(c, code ?? '');
  if (rejected) return rejected;
  return c.json(await registrationOptions(c, 'setup'));
});

authRoutes.post('/setup/finish', requireSameOrigin, async (c) => {
  const { code, response } = await c.req.json<{ code: string; response: RegistrationResponseJSON }>();
  const rejected = await checkSetupCode(c, code ?? '');
  if (rejected) return rejected;
  const passkey = await verifyRegistration(c, response, 'setup');
  if (!passkey) return c.json({ error: 'The passkey could not be verified. Try again.' }, 400);

  const codeHash = await sha256(c.env.SETUP_CODE!);
  // One transaction: only while setup is still open for this code, replace all passkeys and
  // sessions (recovery revokes everything else) and mark the code consumed.
  const open = '(SELECT consumed_code_hash IS NULL OR consumed_code_hash != ?1 FROM setup_state WHERE id = 1)';
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM sessions WHERE ${open} RETURNING id`).bind(codeHash),
    c.env.DB.prepare(`DELETE FROM passkeys WHERE ${open}`).bind(codeHash),
    c.env.DB.prepare(
      `INSERT INTO passkeys (id, public_key, counter, transports, name, created_at) SELECT ?2, ?3, ?4, ?5, ?6, ?7 WHERE ${open}`,
    ).bind(codeHash, passkey.id, passkey.publicKey, passkey.counter, passkey.transports, passkeyName(c.req.header('User-Agent')), now()),
    c.env.DB.prepare(
      'UPDATE setup_state SET consumed_code_hash = ?1, failed_attempts = 0 WHERE id = 1 AND (consumed_code_hash IS NULL OR consumed_code_hash != ?1)',
    ).bind(codeHash),
  ]);
  if (results[2].meta.changes !== 1) return c.json({ error: 'Setup is closed. Sign in with your passkey.', code: 'closed' }, 409);
  const revoked = (results[0].results as { id: string }[]).map((r) => r.id);
  c.executionCtx.waitUntil(closeSessionSockets(c.env, revoked));
  await createSession(c, passkey.id);
  return c.json({ ok: true });
});

// --- Sign-in ----------------------------------------------------------------------------

authRoutes.post('/auth/options', requireSameOrigin, async (c) => {
  const options = await generateAuthenticationOptions({
    rpID: rpFor(c).rpID,
    userVerification: 'required',
  });
  await storeChallenge(c.env.DB, options.challenge, 'auth');
  return c.json(options);
});

authRoutes.post('/auth/verify', requireSameOrigin, async (c) => {
  const { response } = await c.req.json<{ response: AuthenticationResponseJSON }>();
  const challenge = challengeOf(response);
  if (!(await takeChallenge(c.env.DB, challenge, 'auth'))) {
    return c.json({ error: 'The sign-in request expired. Try again.' }, 400);
  }
  const passkey = await c.env.DB.prepare('SELECT * FROM passkeys WHERE id = ?')
    .bind(response.id)
    .first<{ id: string; public_key: string; counter: number; transports: string | null }>();
  if (!passkey) return c.json({ error: 'This passkey is not registered here.' }, 401);
  const { rpID, origin } = rpFor(c);
  let verified = false;
  let newCounter = passkey.counter;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: fromBase64url(passkey.public_key),
        counter: passkey.counter,
        transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
      },
    });
    verified = result.verified;
    newCounter = result.authenticationInfo.newCounter;
  } catch {
    verified = false;
  }
  if (!verified) return c.json({ error: 'The passkey could not be verified.' }, 401);
  await c.env.DB.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
    .bind(newCounter, now(), passkey.id)
    .run();
  await createSession(c, passkey.id);
  return c.json({ ok: true });
});

authRoutes.post('/auth/logout', requireSameOrigin, async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// --- Passkeys and sessions (owner session) ------------------------------------------------

export const accountRoutes = new Hono<HonoEnv>();

accountRoutes.get('/passkeys', async (c) => {
  const rows = await c.env.DB.prepare('SELECT id, name, created_at, last_used_at FROM passkeys ORDER BY created_at').all();
  return c.json({ passkeys: rows.results });
});

accountRoutes.post('/passkeys/options', async (c) => c.json(await registrationOptions(c, 'add')));

accountRoutes.post('/passkeys', async (c) => {
  const { response } = await c.req.json<{ response: RegistrationResponseJSON }>();
  const passkey = await verifyRegistration(c, response, 'add');
  if (!passkey) return c.json({ error: 'The passkey could not be verified. Try again.' }, 400);
  await c.env.DB.prepare('INSERT INTO passkeys (id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(passkey.id, passkey.publicKey, passkey.counter, passkey.transports, passkeyName(c.req.header('User-Agent')), now())
    .run();
  return c.json({ ok: true });
});

accountRoutes.patch('/passkeys/:id', async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  const clean = (name ?? '').trim().slice(0, 64);
  if (!clean) return c.json({ error: 'Give the passkey a name.' }, 400);
  await c.env.DB.prepare('UPDATE passkeys SET name = ? WHERE id = ?').bind(clean, c.req.param('id')).run();
  return c.json({ ok: true });
});

accountRoutes.delete('/passkeys/:id', async (c) => {
  // Never the last one: the DELETE only runs while another passkey exists.
  const result = await c.env.DB.prepare(
    'DELETE FROM passkeys WHERE id = ?1 AND (SELECT COUNT(*) FROM passkeys WHERE id != ?1) > 0',
  )
    .bind(c.req.param('id'))
    .run();
  if (result.meta.changes !== 1) return c.json({ error: 'You cannot delete your last passkey.' }, 409);
  const sessions = await c.env.DB.prepare('DELETE FROM sessions WHERE passkey_id = ? RETURNING id')
    .bind(c.req.param('id'))
    .all<{ id: string }>();
  await closeSessionSockets(c.env, sessions.results.map((s) => s.id));
  return c.json({ ok: true });
});

accountRoutes.get('/sessions', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT s.id, s.user_agent, s.created_at, s.last_seen_at, p.name AS passkey_name FROM sessions s LEFT JOIN passkeys p ON p.id = s.passkey_id WHERE s.expires_at > ? ORDER BY s.last_seen_at DESC',
  )
    .bind(now())
    .all();
  return c.json({ current: c.get('sessionId'), sessions: rows.results });
});

accountRoutes.delete('/sessions/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(c.req.param('id')).run();
  await closeSessionSockets(c.env, [c.req.param('id')]);
  return c.json({ ok: true });
});

/** Revoking a session also closes its open terminal sockets on every server. */
export async function closeSessionSockets(env: Env, sessionIds: string[]) {
  if (sessionIds.length === 0) return;
  const servers = await env.DB.prepare('SELECT id FROM servers').all<{ id: string }>();
  await Promise.all(
    servers.results.map((s) =>
      env.SERVER_CONNECTION.get(env.SERVER_CONNECTION.idFromName(s.id)).closeBrowserSessions(sessionIds),
    ),
  );
}
