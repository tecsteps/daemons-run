import { expect, test } from '@playwright/test';
import { startFakeHetzner } from './fake-hetzner';
import { shoot, virtualPasskey } from './helpers';

// Local only: runs against wrangler dev with HETZNER_API_BASE pointing at the fake API.
test.skip(!!process.env.BASE_URL && !process.env.BASE_URL.includes('localhost'), 'needs the fake Hetzner API');

test('connect Hetzner, create, watch progress, delete; add an existing machine', async ({ page, context, baseURL }) => {
  const hetzner = startFakeHetzner();
  try {
    const passkey = await virtualPasskey(page, baseURL!);
    const origin = new URL(baseURL!).origin;
    await page.goto('/login');
    await page.getByTestId('sign-in').click();
    await expect(page).toHaveURL(/\/servers/);
    // Start clean: remove servers and the provider from earlier runs.
    const { servers } = await (await page.request.get('/api/servers')).json();
    for (const s of servers) await page.request.delete(`/api/servers/${s.id}`, { data: { confirm: s.name }, headers: { Origin: origin } });
    await page.request.delete('/api/providers/hetzner', { headers: { Origin: origin } });

    await page.goto('/servers/new');
    await expect(page.getByTestId('hetzner-token')).toBeVisible();
    await shoot(context, '/servers/new', '04-provisioning', 'connect-hetzner');
    await page.getByTestId('hetzner-token').fill('bad-token');
    await page.getByTestId('connect-hetzner').click();
    await expect(page.getByRole('alert')).toContainText('rejected the API token');
    await page.getByTestId('hetzner-token').fill('good-token');
    await page.getByTestId('connect-hetzner').click();
    await expect(page.getByTestId('server-type-group-cost-optimized')).toBeVisible();

    // The credential never comes back from the API.
    const providers = await (await page.request.get('/api/providers')).text();
    expect(providers).not.toContain('good-token');

    await expect(page.getByTestId('server-name')).toHaveValue('server-1');
    await expect(page.getByTestId('server-type-group-cost-optimized')).toContainText('cx23');
    await shoot(context, '/servers/new', '04-provisioning', 'create-form', async (p) => {
      await p.getByTestId('server-type-group-cost-optimized').waitFor();
    });
    // The full list: change dialog shows unavailable types only with the switch on.
    await page.getByTestId('server-lane-change-regular-performance').click();
    await expect(page.getByTestId('server-type-option-cpx22')).toBeVisible();
    await expect(page.getByTestId('server-type-option-cpx11')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('server-unavailable-toggle').click();
    await page.getByTestId('server-lane-change-regular-performance').click();
    await expect(page.getByTestId('server-type-option-cpx11')).toContainText('Not available in nbg1');
    await page.keyboard.press('Escape');
    await page.getByTestId('server-type-group-cost-optimized').click();

    await page.getByTestId('agent-codex').click();
    await page.getByTestId('server-name').fill('web-1');
    await page.getByTestId('create-server').click();
    await expect(page.getByRole('dialog')).toContainText('starting now');
    await expect(page.getByTestId('purchase-cancel')).toBeFocused();
    await page.screenshot({ path: '../docs/qa/04-provisioning/confirm-dialog-desktop-light.png' });
    await page.getByTestId('purchase-confirm').click();
    await expect(page).toHaveURL(/\/servers\/srv_/);
    await expect(page.getByTestId('progress')).toBeVisible();

    const order = hetzner.created.at(-1);
    expect(order.server_type).toBe('cx23');
    expect(order.location).toBe('nbg1');
    expect(order.labels['managed-by']).toBe('daemons');
    expect(order.user_data).toContain('#cloud-config');
    expect(order.user_data).toContain('claude codex');
    const token = /enroll-token[\s\S]*?content:\s*"?([^"\s]+)/.exec(order.user_data)?.[1];
    expect(token).toBeTruthy();

    // The installer reports progress with the enrollment token.
    if (token) {
      const r = await page.request.post('/agent/progress', { headers: { Authorization: `Bearer ${token}` }, data: { step: 'docker', status: 'running', log: 'Installing Docker…' } });
      expect(r.status()).toBe(204);
      await expect(page.getByTestId('progress')).toContainText('docker');
    }
    await shoot(context, page.url().replace(origin, ''), '04-provisioning', 'progress', async (p) => {
      await p.getByTestId('progress').waitFor();
    });

    // A provider error keeps the form and buys nothing.
    await page.goto('/servers/new');
    await page.getByTestId('server-name').fill('quota');
    await page.getByTestId('create-server').click();
    await page.getByTestId('purchase-confirm').click();
    await expect(page.getByRole('alert')).toContainText('server limit exceeded');

    // Delete with typed confirmation removes it at the provider.
    const list = await (await page.request.get('/api/servers')).json();
    const web = list.servers.find((s: { name: string }) => s.name === 'web-1');
    await page.goto(`/servers/${web.id}`);
    await page.getByTestId('delete-server').click();
    await expect(page.getByTestId('confirm-destructive')).toBeDisabled();
    await page.getByTestId('confirm-name').fill('web-1');
    await page.getByTestId('confirm-destructive').click();
    await expect(page).toHaveURL(/\/servers$/);
    expect(hetzner.servers.size).toBe(0);

    // Existing machine: a one-line install command.
    await page.goto('/servers/new?existing=1');
    await page.getByTestId('server-name').fill('home-box');
    await page.getByTestId('add-existing').click();
    await expect(page.getByTestId('install-command')).toContainText('install.sh | sudo DAEMONS_TOKEN=');
    await shoot(context, '/servers', '04-provisioning', 'servers-list');
    await passkey.save();
  } finally {
    hetzner.close();
  }
});
