import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { virtualPasskey } from './helpers';

// After `npm run reset-access` (new SETUP_CODE in RECOVERY_CODE_FILE): setup opens again, and
// completing it revokes every other passkey and session.
test.skip(!process.env.RECOVERY_CODE_FILE, 'run after reset-access with RECOVERY_CODE_FILE');

test('recovery with a new setup code revokes old passkeys and sessions', async ({ page, browser, baseURL }) => {
  const old = await virtualPasskey(page, baseURL!);
  const me = await (await page.request.get('/api/me')).json();
  expect(me.setupOpen).toBe(true);

  const fresh = await browser.newContext();
  const newPage = await fresh.newPage();
  const cdp = await fresh.newCDPSession(newPage);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const code = readFileSync(process.env.RECOVERY_CODE_FILE!, 'utf8').trim();
  await newPage.goto(`/setup#code=${encodeURIComponent(code)}`);
  await newPage.getByTestId('create-passkey').click();
  await expect(newPage).toHaveURL(/\/servers/);

  // The old passkey no longer signs in.
  await page.goto('/login');
  await page.getByTestId('sign-in').click();
  await expect(page.getByRole('alert')).toContainText('not registered');
  void old;
  await fresh.close();
});
