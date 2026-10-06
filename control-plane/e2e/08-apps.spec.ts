import { expect, test } from '@playwright/test';
import { AGENT_CONTAINER, connectLocalAgent, sh } from './local-agent';
import { shoot, virtualPasskey } from './helpers';

test.skip(!AGENT_CONTAINER || !process.env.APPS_URL, 'needs AGENT_CONTAINER and APPS_URL (local apps gateway)');
const APPS = process.env.APPS_URL!;

test('apps: expose from the CLI, private by default, public toggle, not listening, unexpose', async ({ page, context, baseURL, browser }) => {
  await virtualPasskey(page, baseURL!);
  const origin = new URL(baseURL!).origin;
  await page.goto('/login');
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/servers/);
  await connectLocalAgent(page, origin);
  for (const a of (await (await page.request.get('/api/apps')).json()).apps) {
    await page.request.delete(`/api/apps/${a.name}`, { headers: { Origin: origin } });
  }

  // A tiny app under its base path, started as the daemon user.
  sh(`mkdir -p /projects/shop/shop && echo '<h1>hello from shop</h1>' > /projects/shop/shop/index.html && cd /projects/shop && { [ -f /tmp/shop.pid ] && kill $(cat /tmp/shop.pid) 2>/dev/null; true; } && { nohup python3 -m http.server 3000 --bind 127.0.0.1 > /tmp/shop.log 2>&1 & echo $! > /tmp/shop.pid; } && sleep 1`, 'dev');
  const out = sh('cd /projects/shop && daemons-agent cli expose 3000 --name shop', 'dev');
  expect(out).toContain(`${APPS}/shop/`);

  // The Apps page lists it; private by default.
  await page.goto('/apps');
  await expect(page.getByTestId('app-shop')).toContainText('Private');
  await shoot(context, '/apps', '08-apps', 'apps');

  // Owner: redirect through the control plane, then the app.
  await page.goto(`${APPS}/shop/`);
  await expect(page.locator('h1')).toHaveText('hello from shop');
  expect(page.url()).not.toContain('__daemons_ticket');

  // Signed-out visitor: sent to sign-in.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`${APPS}/shop/`);
  await expect(anonPage).toHaveURL(/\/login/);

  // Public: no sign-in.
  await page.goto('/apps');
  await page.getByTestId('public-shop').click();
  await expect(page.getByTestId('app-shop')).toContainText('Public link');
  const t0 = Date.now();
  await anonPage.goto(`${APPS}/shop/`);
  await expect(anonPage.locator('h1')).toHaveText('hello from shop');
  console.log(`public after ${Date.now() - t0} ms`);

  // Not listening: a friendly page, not a 502 from nowhere.
  sh('cd /projects/shop && daemons-agent cli expose 3999 --name ghost --public', 'dev');
  await anonPage.goto(`${APPS}/ghost/`);
  await expect(anonPage.locator('h1')).toContainText('ghost is not running');
  await anonPage.screenshot({ path: '../docs/qa/08-apps/not-listening-desktop-dark.png' });

  // Unexpose: gone within 2 s.
  sh('daemons-agent cli unexpose ghost', 'dev');
  const t1 = Date.now();
  await anonPage.goto(`${APPS}/ghost/`);
  await expect(anonPage.locator('h1')).toContainText('ghost is not exposed');
  expect(Date.now() - t1).toBeLessThan(2000);

  // Port offers on the Apps page for listening ports without an app.
  sh(`{ [ -f /tmp/vite.pid ] && kill $(cat /tmp/vite.pid) 2>/dev/null; true; } && { nohup python3 -m http.server 5173 --bind 127.0.0.1 > /tmp/vite.log 2>&1 & echo $! > /tmp/vite.pid; } && sleep 1`, 'dev');
  await page.goto('/apps');
  await expect(page.getByTestId('expose-5173')).toBeVisible();
  await shoot(context, '/apps', '08-apps', 'apps-offers', async (p) => {
    await p.getByTestId('expose-5173').waitFor();
  });
  await page.getByTestId('expose-5173').click();
  await expect(page.getByTestId('expose-5173')).toHaveCount(0);
  await anon.close();
});
