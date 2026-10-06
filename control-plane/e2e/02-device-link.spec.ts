import { expect, test } from '@playwright/test';
import { shoot, virtualPasskey } from './helpers';

test('add a device: a single-use link registers that device its own passkey', async ({ page, context, baseURL, browser }) => {
  await virtualPasskey(page, baseURL!);
  await page.goto('/login');
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/servers/);
  const before = (await (await page.request.get('/api/passkeys')).json()).passkeys.length;
  await page.goto('/settings');
  await page.getByTestId('add-device').click();
  await expect(page.getByTestId('device-qr').locator('svg')).toBeVisible();
  const url = await page.getByTestId('device-link').locator('code').innerText();
  expect(url).toMatch(/\/add-device#t=/);
  await page.screenshot({ path: '../docs/qa/02-auth/device-link-desktop-light.png' });

  // The "phone": a fresh browser with its own authenticator and no session.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await phoneContext.newPage();
  const cdp = await phoneContext.newCDPSession(phone);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await phone.goto(url);
  await expect(phone).toHaveURL(/\/add-device$/);
  await phone.screenshot({ path: '../docs/qa/02-auth/add-device-phone-dark.png' });
  await phone.getByTestId('add-device-passkey').click();
  await expect(phone).toHaveURL(/\/servers/);

  // Signed out, the phone signs in with its new passkey.
  await phone.request.post('/api/auth/logout', { headers: { Origin: new URL(baseURL!).origin } });
  await phone.goto('/login');
  await phone.getByTestId('sign-in').click();
  await expect(phone).toHaveURL(/\/servers/);

  // The link works once.
  const again = await browser.newContext();
  const againPage = await again.newPage();
  await againPage.goto(url);
  const r = await againPage.request.post('/api/device/options', {
    data: { token: /t=(.+)$/.exec(url)![1] },
    headers: { Origin: new URL(baseURL!).origin },
  });
  expect(r.status()).toBe(410);

  // The owner sees two passkeys and can remove the phone's.
  await page.goto('/settings');
  await expect(page.getByTestId('passkeys').getByRole('listitem')).toHaveCount(before + 1);
  await page.getByTestId('passkeys').getByRole('listitem').last().getByRole('button', { name: /^Delete / }).click();
  await page.getByTestId('confirm-destructive').click();
  await expect(page.getByTestId('passkeys').getByRole('listitem')).toHaveCount(before);
  await shoot(context, '/settings', '02-auth', 'settings-passkeys');
  await phoneContext.close();
  await again.close();
});
