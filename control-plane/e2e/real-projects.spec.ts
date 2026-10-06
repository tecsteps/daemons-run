import { expect, test } from '@playwright/test';
import { shoot, virtualPasskey } from './helpers';

test.skip(!process.env.REAL_SERVER, 'set REAL_SERVER to an online server on daemons-dev');
test.setTimeout(10 * 60_000);

test('projects on a real server: Compose start/stop, delete removes containers and folder', async ({ page, context, baseURL }) => {
  await virtualPasskey(page, baseURL!);
  const origin = new URL(baseURL!).origin;
  await page.goto('/login');
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/servers/);
  const server = (await (await page.request.get('/api/servers')).json()).servers.find((s: { name: string }) => s.name === process.env.REAL_SERVER);
  const api = (path: string) => `/api/servers/${server.id}${path}`;
  const headers = { Origin: origin };
  await page.request.delete(api('/projects/composed'), { data: { confirm: 'composed' }, headers });

  expect((await page.request.post(api('/projects'), { data: { name: 'composed' }, headers })).status()).toBe(201);
  const compose = 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8088:80"\n  cache:\n    image: redis:alpine\n';
  expect((await page.request.put(api(`/files/content?path=${encodeURIComponent('/projects/composed/compose.yaml')}`), { data: compose, headers })).status()).toBe(200);

  await page.goto('/projects');
  await expect(page.getByTestId('compose-composed')).toBeVisible();
  await page.getByTestId('compose-up-composed').click();
  await expect(page.getByTestId('compose-composed')).toContainText('Running', { timeout: 180_000 });
  await expect(page.getByTestId('compose-composed').getByText('Running')).toHaveCount(2, { timeout: 60_000 });
  await shoot(context, '/projects', '07-projects', 'real-compose', async (p) => {
    await p.getByTestId('compose-composed').getByText('Running').first().waitFor({ timeout: 30_000 });
  });

  // The published port stays on loopback (installer's Docker default).
  const ports = (await (await page.request.get(api('/ports'))).json()).ports.filter((p: { port: number }) => p.port === 8088);
  expect(ports.length).toBeGreaterThan(0);
  for (const p of ports) expect(['127.0.0.1', '::1']).toContain(p.address);

  // Delete: compose down first, then the folder; no containers left.
  await page.getByRole('button', { name: 'Delete composed' }).click();
  await page.getByTestId('confirm-name').fill('composed');
  await page.getByTestId('confirm-destructive').click();
  await expect(page.getByTestId('project-composed')).toHaveCount(0, { timeout: 120_000 });
  const files = await page.request.get(api('/files?path=/projects'));
  expect(JSON.stringify(await files.json())).not.toContain('"composed"');
});
