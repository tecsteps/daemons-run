import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

/**
 * Local E2E: a real daemons-agent in a Docker container (AGENT_CONTAINER) enrolls with the
 * control plane through "Add existing server", without the installer.
 */
export const AGENT_CONTAINER = process.env.AGENT_CONTAINER;
const CP_FROM_CONTAINER = process.env.CP_FROM_CONTAINER ?? 'http://host.docker.internal:8787';

export const sh = (script: string, user = 'root') =>
  execFileSync('docker', ['exec', '-u', user, AGENT_CONTAINER!, 'bash', '-lc', script], { encoding: 'utf8' });

export async function connectLocalAgent(page: Page, origin: string, name = 'box'): Promise<string> {
  const existing = (await (await page.request.get('/api/servers')).json()).servers.find((s: { name: string }) => s.name === name);
  if (existing?.status === 'online') return existing.id;
  if (existing) await page.request.delete(`/api/servers/${existing.id}`, { data: { confirm: name }, headers: { Origin: origin } });
  const res = await page.request.post('/api/servers/existing', { data: { name, agents: ['claude'] }, headers: { Origin: origin } });
  const { server, command } = await res.json();
  const token = /DAEMONS_TOKEN=(\S+)/.exec(command)![1];
  sh(`pkill -x daemons-agent || true; rm -f /etc/daemons/agent.toml; printf %s '${token}' > /etc/daemons/enroll-token && chmod 600 /etc/daemons/enroll-token`);
  sh(`daemons-agent enroll --control-plane ${CP_FROM_CONTAINER} --token-file /etc/daemons/enroll-token`);
  sh('nohup daemons-agent run > /var/log/daemons-agent.log 2>&1 &');
  for (let i = 0; i < 40; i++) {
    const s = (await (await page.request.get(`/api/servers/${server.id}`)).json()).server;
    if (s.status === 'online') return server.id;
    await page.waitForTimeout(500);
  }
  throw new Error(`agent did not come online:\n${sh('tail -20 /var/log/daemons-agent.log')}`);
}
