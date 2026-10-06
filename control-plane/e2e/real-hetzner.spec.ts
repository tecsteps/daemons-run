import { expect, test, type Page } from '@playwright/test';
import { shoot, virtualPasskey } from './helpers';

// Buys a real server. Only with REAL_HETZNER=1, against daemons-dev, cheapest tier only.
test.skip(process.env.REAL_HETZNER !== '1', 'set REAL_HETZNER=1 to buy a real test server');
test.setTimeout(30 * 60_000);

const NAME = process.env.SERVER_NAME ?? 'dev-arm-1';
const TYPE = process.env.SERVER_TYPE ?? 'cax11';
const ALLOWED = ['cx23', 'cax11'];

async function screenText(page: Page) {
  return page.evaluate(() => (window as unknown as { __daemonsTerminal?: () => string }).__daemonsTerminal?.() ?? '');
}

test('real Hetzner server: create → online → terminal', async ({ page, context, baseURL }) => {
  expect(ALLOWED).toContain(TYPE);
  await virtualPasskey(page, baseURL!);
  const origin = new URL(baseURL!).origin;
  await page.goto('/login');
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/servers/);

  const providers = await (await page.request.get('/api/providers')).json();
  if (!providers.providers.some((p: { id: string; needsCredentials: boolean }) => p.id === 'hetzner' && !p.needsCredentials)) {
    const r = await page.request.put('/api/providers/hetzner', { data: { token: process.env.HETZNER_API_KEY }, headers: { Origin: origin } });
    expect(r.status()).toBe(200);
  }

  let server = (await (await page.request.get('/api/servers')).json()).servers.find((s: { name: string }) => s.name === NAME);
  if (!server) {
    await page.goto('/servers/new');
    await page.getByTestId('server-name').fill(NAME);
    const options = await (await page.request.get('/api/providers/hetzner/options')).json();
    const size = options.sizes.find((s: { name: string }) => s.name === TYPE);
    const location = ['nbg1', 'fsn1', 'hel1'].find((l) => size.availableIn.includes(l));
    expect(location, `${TYPE} available somewhere in the EU`).toBeTruthy();
    await page.getByTestId('server-location').selectOption(location!);
    await page.getByTestId(`server-lane-change-${size.group}`).click();
    await page.getByTestId(`server-type-option-${TYPE}`).click();
    await expect(page.getByTestId(`server-type-group-${size.group}`)).toContainText(TYPE);
    await page.getByTestId(`server-type-group-${size.group}`).click();
    await page.getByTestId('create-server').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(TYPE);
    const price = Number(/€([\d.]+)\/month/.exec(await dialog.innerText())![1]);
    expect(price).toBeLessThan(7);
    await page.getByTestId('purchase-confirm').click();
    await expect(page).toHaveURL(/\/servers\/srv_/);
    server = (await (await page.request.get('/api/servers')).json()).servers.find((s: { name: string }) => s.name === NAME);
  }
  const started = Date.now();
  let shotStep = '';
  for (;;) {
    const s = (await (await page.request.get(`/api/servers/${server.id}`)).json()).server;
    const step = s.install.step ?? s.status;
    if (step !== shotStep && ['creating', 'docker', 'coding-agents'].includes(step)) {
      shotStep = step;
      await shoot(context, `/servers/${server.id}`, '04-provisioning', `real-progress-${step}`);
    }
    if (s.status === 'online') break;
    if (s.status === 'failed' || s.install.status === 'failed') throw new Error(`install failed at ${s.install.step}:\n${s.install.log}`);
    if (Date.now() - started > 20 * 60_000) throw new Error(`not online after 20 min, step ${step}`);
    await page.waitForTimeout(10_000);
  }
  console.log(`online after ${Math.round((Date.now() - started) / 1000)} s`);
  await shoot(context, `/servers/${server.id}`, '04-provisioning', 'real-online');

  await page.goto(`/servers/${server.id}/terminal?s=check&command=bash`);
  await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
  await page.locator('[data-testid="terminal"] .xterm-helper-textarea').focus();
  await page.keyboard.type('docker version --format "docker {{.Server.Version}}"; claude --version; id -un; ss -tlnp | grep -v 127.0.0 | grep -c LISTEN; echo done-check\n');
  await expect.poll(() => screenText(page), { timeout: 60_000 }).toContain('done-check');
  const text = await screenText(page);
  console.log(text.split('\n').filter((l) => l.trim()).slice(-8).join('\n'));
  expect(text).toMatch(/docker \d+\./);
  expect(text).toMatch(/^dev$/m);
  await shoot(context, `/servers/${server.id}/terminal?s=check`, '06-terminal', 'real-server', async (p) => {
    await expect(p.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
    await p.waitForTimeout(1000);
  });
});
