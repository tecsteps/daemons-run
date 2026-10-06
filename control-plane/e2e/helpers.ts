import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * A CDP virtual authenticator whose credentials persist in e2e/.auth/<host>.json, so later
 * runs can sign in with the passkey an earlier run registered.
 */
export async function virtualPasskey(page: Page, baseURL: string) {
  const host = new URL(baseURL).hostname;
  const file = join(here, '.auth', `${host}.json`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  if (existsSync(file)) {
    for (const credential of JSON.parse(readFileSync(file, 'utf8'))) {
      // A stored credential's counter is stale after later sign-ins; a time-based one only grows.
      await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: { ...credential, signCount: Math.floor(Date.now() / 1000) } });
    }
  }
  return {
    async save() {
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(credentials), { mode: 0o600 });
    },
    async clear() {
      await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
    },
  };
}

export const shotsDir = (epic: string) => {
  const dir = join(here, '..', '..', 'docs', 'qa', epic);
  mkdirSync(dir, { recursive: true });
  return dir;
};

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;

/** Screenshots of the current URL: desktop and phone, light and dark. */
export async function shoot(context: BrowserContext, path: string, epic: string, name: string, wait?: (page: Page) => Promise<void>) {
  const dir = shotsDir(epic);
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    for (const scheme of ['light', 'dark'] as const) {
      const page = await context.newPage();
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript(() => {
        try {
          localStorage.setItem('daemons:theme', 'system');
        } catch {}
      });
      await page.goto(path);
      await page.waitForLoadState('load');
      await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
      if (wait) await wait(page);
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(dir, `${name}-${vp}-${scheme}.png`), fullPage: false });
      // No horizontal page scroll at any width.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`${name} ${vp} ${scheme}: horizontal overflow of ${overflow}px`);
      await page.close();
    }
  }
}
