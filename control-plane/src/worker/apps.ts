import { AgentError } from './server-connection';
import { now } from './crypto';
import type { Env } from './env';

export type AppRow = { name: string; server_id: string; port: number; cwd: string | null; public: number; created_at: number };

export const APP_NAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export async function exposeApp(
  env: Env,
  serverId: string,
  input: { name: string; port: number; cwd: string | null; public: boolean },
): Promise<{ name: string; public: boolean }> {
  const name = input.name.toLowerCase();
  if (!APP_NAME.test(name)) {
    throw new AgentError('bad_request', 'App names use a-z, 0-9 and dashes, up to 40 characters.');
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new AgentError('bad_request', 'The port must be between 1 and 65535.');
  }
  const existing = await env.DB.prepare('SELECT * FROM apps WHERE name = ?').bind(name).first<AppRow>();
  if (existing && existing.server_id !== serverId) {
    throw new AgentError('exists', `The name ${name} is used by an app on another server.`);
  }
  if (existing) {
    await env.DB.prepare('UPDATE apps SET port = ?, cwd = COALESCE(?, cwd), public = ? WHERE name = ?')
      .bind(input.port, input.cwd, input.public ? 1 : existing.public, name)
      .run();
    return { name, public: input.public || !!existing.public };
  }
  await env.DB.prepare('INSERT INTO apps (name, server_id, port, cwd, public, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(name, serverId, input.port, input.cwd, input.public ? 1 : 0, now())
    .run();
  return { name, public: input.public };
}

export async function unexposeApp(env: Env, serverId: string, name: string) {
  const result = await env.DB.prepare('DELETE FROM apps WHERE name = ? AND server_id = ?').bind(name, serverId).run();
  if (result.meta.changes === 0) throw new AgentError('not_found', `No app named ${name} on this server.`);
}

export async function listApps(env: Env, serverId?: string): Promise<AppRow[]> {
  const rows = serverId
    ? await env.DB.prepare('SELECT * FROM apps WHERE server_id = ? ORDER BY name').bind(serverId).all<AppRow>()
    : await env.DB.prepare('SELECT * FROM apps ORDER BY name').all<AppRow>();
  return rows.results;
}
