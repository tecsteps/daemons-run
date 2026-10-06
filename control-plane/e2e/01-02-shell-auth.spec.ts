import { expect, test } from '@playwright/test';
import { shoot, virtualPasskey } from './helpers';

const SETUP_CODE = process.env.SETUP_CODE ?? 'local-setup-code';

test('setup, sign-in, shell and settings', async ({ page, context, baseURL }) => {
  const passkey = await virtualPasskey(page, baseURL!);
  await page.goto('/api/me');
  const me = JSON.parse(await page.locator('body').innerText());

  if (me.setupOpen) {
    // Signed-out root goes to setup while it is open.
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/);
    await shoot(context, '/setup', '02-auth', 'setup');
    // Wrong code says how many attempts are left.
    await page.getByTestId('setup-code').fill('wrong-code');
    await page.getByTestId('create-passkey').click();
    await expect(page.getByRole('alert')).toContainText('attempts left');
    await page.goto(`/setup#code=${encodeURIComponent(SETUP_CODE)}`);
    await expect(page.getByTestId('setup-code')).toHaveValue(SETUP_CODE);
    await page.getByTestId('create-passkey').click();
    await expect(page).toHaveURL(/\/servers\?welcome=1/);
    await passkey.save();
  } else {
    await page.goto('/servers');
    await expect(page).toHaveURL(/\/login/);
    await page.getByTestId('sign-in').click();
    await expect(page).toHaveURL(/\/servers/);
  }

  // Setup is closed now: the same code does nothing.
  const closed = await page.request.post('/api/setup/options', { data: { code: SETUP_CODE }, headers: { Origin: new URL(baseURL!).origin } });
  expect(closed.status()).toBe(409);

  // Cross-origin writes are rejected even with a valid cookie.
  const cross = await page.request.post('/api/auth/logout', { headers: { Origin: 'https://evil.example' } });
  expect(cross.status()).toBe(403);

  await expect(page.getByRole('heading', { name: 'Servers', exact: true })).toBeVisible();
  for (const [path, name] of [
    ['/servers', 'servers'],
    ['/projects', 'projects'],
    ['/apps', 'apps'],
    ['/settings', 'settings'],
    ['/nope', 'not-found'],
  ] as const) {
    await shoot(context, path, '01-shell', name);
  }

  // Sign out, then the sign-in page, then sign in again with the stored passkey.
  await page.goto('/settings');
  await page.request.post('/api/auth/logout', { headers: { Origin: new URL(baseURL!).origin } });
  await page.goto('/servers');
  await expect(page).toHaveURL(/\/login/);
  await shoot(context, '/login', '02-auth', 'login');
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/servers/);

  // Without a session every owner route answers 401.
  const anon = await page.context().browser()!.newContext();
  for (const path of ['/api/servers', '/api/passkeys', '/api/sessions', '/api/providers', '/api/apps', '/api/settings/ssh-key']) {
    expect((await anon.request.get(new URL(path, baseURL).toString())).status(), path).toBe(401);
  }
  await anon.close();
});
