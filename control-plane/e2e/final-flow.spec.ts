import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { virtualPasskey } from './helpers';

// The product flow end to end, against daemons-dev and a freshly bought CX23 (FINAL_FLOW=1).
// The fresh-account install (path B) is covered by docs/qa/03-installation.
test.skip(process.env.FINAL_FLOW !== '1', 'set FINAL_FLOW=1 (buys a CX23)');
test.setTimeout(40 * 60_000);

const HOME = process.env.HOME_URL ?? 'https://daemons-run-website.fabian-wesner.workers.dev';
const NAME = process.env.SERVER_NAME ?? 'final-cx23';
const OUT = '../docs/qa/final';
const APP = process.env.APP_NAME ?? 'shop';
mkdirSync(OUT, { recursive: true });

const terminalText = (page: Page) =>
  page.evaluate(() => (window as unknown as { __daemonsTerminal?: () => string }).__daemonsTerminal?.() ?? '');
const RUN = Date.now().toString(36);

async function run(page: Page, command: string, step: string, timeout = 120_000) {
  const marker = `${step}x${RUN}`;
  await page.locator('[data-testid="terminal"] .xterm-helper-textarea').focus();
  await page.keyboard.type(`${command}; echo ${marker}-$?\n`);
  await expect.poll(() => terminalText(page), { timeout }).toMatch(new RegExp(`${marker}-\\d`));
  expect(Number(new RegExp(`${marker}-(\\d+)`).exec(await terminalText(page))![1]), command).toBe(0);
}

test('homepage → control plane → fresh CX23 → phone terminal → Claude Code → app link', async ({ page, browser, baseURL }) => {
  const t0 = Date.now();
  const stamp = (what: string) => console.log(`${Math.round((Date.now() - t0) / 1000)}s ${what}`);

  // 1. The homepage leads to an install.
  await page.goto(HOME);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('never sleep');
  await page.screenshot({ path: `${OUT}/01-homepage.png` });
  await page.getByRole('link', { name: 'Install', exact: true }).first().click();
  await expect(page.locator('a[href*="deploy.workers.cloudflare.com"]')).toBeVisible();
  await expect(page.locator('body')).toContainText('install.md');
  await page.screenshot({ path: `${OUT}/02-install-page.png`, fullPage: true });
  const md = await page.request.get(`${HOME}/install.md`);
  expect(md.headers()['content-type']).toContain('text/markdown');
  expect(await md.text()).toContain('npm run install-control-plane');
  stamp('homepage and install page');

  // 2. Sign in with the passkey (registered at setup).
  await virtualPasskey(page, baseURL!);
  await page.goto(`${baseURL}/login`);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/servers/);
  stamp('signed in');

  // 3. Hetzner is connected (Settings).
  await page.goto(`${baseURL}/settings`);
  await expect(page.getByTestId('providers')).toContainText('Connected');

  // 4. Create a fresh CX23 through the form.
  const existing = (await (await page.request.get(`${baseURL}/api/servers`)).json()).servers.find((s: { name: string }) => s.name === NAME);
  // RESUME=1 continues with a server this flow created minutes ago (after a test fix).
  if (!process.env.RESUME) expect(existing, `${NAME} must not exist yet: this run proves a fresh server`).toBeUndefined();
  if (!existing) {
  await page.goto(`${baseURL}/servers/new`);
  await page.getByTestId('server-name').fill(NAME);
  const options = await (await page.request.get(`${baseURL}/api/providers/hetzner/options`)).json();
  const cx23 = options.sizes.find((s: { name: string }) => s.name === 'cx23');
  const location = ['nbg1', 'fsn1', 'hel1'].find((l) => cx23.availableIn.includes(l))!;
  await page.getByTestId('server-location').selectOption(location);
  await page.getByTestId('server-lane-change-cost-optimized').click();
  await page.getByTestId('server-type-option-cx23').click();
  await page.getByTestId('server-type-group-cost-optimized').click();
  await page.getByTestId('agent-opencode').click();
  await page.screenshot({ path: `${OUT}/03-create-form.png`, fullPage: true });
  await page.getByTestId('create-server').click();
  await expect(page.getByRole('dialog')).toContainText('cx23');
  const price = Number(/€([\d.]+)\/month/.exec(await page.getByRole('dialog').innerText())![1]);
  expect(price).toBeLessThan(6);
  await page.getByTestId('purchase-confirm').click();
  await expect(page).toHaveURL(/\/servers\/srv_/);
  stamp(`ordered cx23 in ${location}`);
  }
  const serverId = (await (await page.request.get(`${baseURL}/api/servers`)).json()).servers.find((s: { name: string }) => s.name === NAME).id as string;
  await page.goto(`${baseURL}/servers/${serverId}`);
  let shotProgress = false;
  for (;;) {
    const s = (await (await page.request.get(`${baseURL}/api/servers/${serverId}`)).json()).server;
    if (!shotProgress && s.install.step) {
      shotProgress = true;
      await page.screenshot({ path: `${OUT}/04-progress.png` });
    }
    if (s.status === 'online') break;
    if (s.status === 'failed' || s.install.status === 'failed') throw new Error(`install failed at ${s.install.step}:\n${s.install.log}`);
    if (Date.now() - t0 > 15 * 60_000) throw new Error(`not online after 15 min (${s.install.step ?? s.status})`);
    await page.waitForTimeout(5000);
  }
  stamp('server online');
  await page.reload();
  await expect(page.getByText('Online', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${OUT}/05-server-online.png` });

  // 5. A terminal on a phone; Claude Code starts.
  const phoneContext = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  const phone = await phoneContext.newPage();
  await phone.goto(`${baseURL}/servers/${serverId}/terminal`);
  if (await phone.getByTestId('quick-claude').isVisible({ timeout: 10_000 }).catch(() => false)) {
    await phone.getByTestId('quick-claude').click();
  } else {
    await phone.goto(`${baseURL}/servers/${serverId}/terminal?s=claude&command=claude`);
  }
  await expect(phone.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
  await expect.poll(() => terminalText(phone), { timeout: 60_000 }).toMatch(/Claude Code/);
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: `${OUT}/06-phone-claude-code.png` });
  stamp('Claude Code running on the phone terminal');

  // 6. A shell: start an app on localhost:3000 and expose it.
  await phone.getByTestId('terminal-new').click();
  await expect(phone.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
  // The app serves under its base path /<name>/, as exposed apps do.
  await run(phone, `mkdir -p /projects/shop/${APP} && echo '<h1>Hello from the final run</h1>' > /projects/shop/${APP}/index.html && cd /projects/shop`, 's1');
  await run(phone, '(nohup python3 -m http.server 3000 --bind 127.0.0.1 >/dev/null 2>&1 &) && sleep 1', 's2');
  await run(phone, `daemons expose 3000 --name ${APP}`, 's3');
  // At phone width the printed URL wraps across rows; the API has it whole.
  const url = (await (await phone.request.get(`${baseURL}/api/apps`)).json()).apps.find((a: { name: string }) => a.name === APP).url as string;
  expect(await terminalText(phone)).toContain('daemons-apps');
  await phone.screenshot({ path: `${OUT}/07-phone-expose.png` });
  stamp(`exposed at ${url}`);

  // 7. Open the link on the phone: private app, owner session, the page.
  await phone.goto(url);
  await expect(phone.locator('h1')).toHaveText('Hello from the final run', { timeout: 30_000 });
  await phone.screenshot({ path: `${OUT}/08-phone-app.png` });
  stamp('app opened on the phone');

  // A stranger does not get in.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(url);
  await expect(anonPage).toHaveURL(/\/login/);
  await anon.close();
  await phoneContext.close();
  stamp('done');
});
