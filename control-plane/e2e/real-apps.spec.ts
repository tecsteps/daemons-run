import { expect, test, type Page } from '@playwright/test';
import { shoot, virtualPasskey } from './helpers';

// Against daemons-dev and an online real server (REAL_SERVER=<name>).
test.skip(!process.env.REAL_SERVER, 'set REAL_SERVER to an online server on daemons-dev');
test.setTimeout(20 * 60_000);

const terminalText = (page: Page) =>
  page.evaluate(() => (window as unknown as { __daemonsTerminal?: () => string }).__daemonsTerminal?.() ?? '');

const RUN = Date.now().toString(36);

async function run(page: Page, command: string, step: string, timeout = 120_000) {
  const marker = `${step}x${RUN}`;
  await page.locator('[data-testid="terminal"] .xterm-helper-textarea').focus();
  await page.keyboard.type(`${command}; echo ${marker}-$?\n`);
  await expect.poll(() => terminalText(page), { timeout }).toMatch(new RegExp(`${marker}-\\d`));
  const code = Number(new RegExp(`${marker}-(\\d+)`).exec(await terminalText(page))![1]);
  expect(code, `${command} exit code`).toBe(0);
}

test('apps on real origins: private ticket flow, cross-origin isolation, Vite HMR, big download vs terminal', async ({ page, context, baseURL, browser }) => {
  await virtualPasskey(page, baseURL!);
  const origin = new URL(baseURL!).origin;
  await page.goto('/login');
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/servers/);
  const server = (await (await page.request.get('/api/servers')).json()).servers.find((s: { name: string }) => s.name === process.env.REAL_SERVER);
  expect(server?.status).toBe('online');
  const { appsOrigin } = await (await page.request.get('/api/apps')).json();

  // A Vite app in Docker (Node is not on the host), published on loopback only.
  await page.goto(`/servers/${server.id}/terminal?s=apps-test&cwd=/projects`);
  await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
  await run(page, 'mkdir -p /projects/shop && cd /projects/shop', 'm1');
  await run(
    page,
    `docker rm -f shopvite >/dev/null 2>&1; test -f app/package.json || docker run --rm -v $PWD:/w -w /w node:22-alpine sh -c "npm create -y vite@latest app -- --template vanilla >/dev/null && cd app && npm install --silent >/dev/null"`,
    'm2',
    600_000,
  );
  await run(page, `sudo chown -R dev: app && docker run -d --name shopvite -p 5173:5173 -v $PWD/app:/app -w /app node:22-alpine npx vite --host 0.0.0.0 --base /shop/ >/dev/null`, 'm3', 300_000);
  await run(page, 'for i in $(seq 1 60); do curl -sf localhost:5173/shop/ >/dev/null && break; sleep 1; done; curl -sf localhost:5173/shop/ >/dev/null', 'm4', 120_000);
  // Docker publishes on 127.0.0.1 by default (installer's daemon.json): not reachable from outside.
  await run(page, "ss -tln | grep ':5173 ' | grep -q '127.0.0.1:5173'", 'm5');
  await run(page, 'daemons expose 5173 --name shop', 'm6');

  // A 100 MB file behind a second app.
  await run(page, 'mkdir -p /projects/dl/files && head -c 100M /dev/urandom > /projects/dl/files/big.bin && cd /projects/dl && (nohup python3 -m http.server 8000 --bind 127.0.0.1 >/dev/null 2>&1 &) && sleep 1 && daemons expose 8000 --name files', 'm7');

  // Owner: private app through the ticket flow.
  const app = await context.newPage();
  const consoleLines: string[] = [];
  app.on('console', (m) => consoleLines.push(m.text()));
  await app.goto(`${appsOrigin}/shop/`);
  await expect(app.locator('#app')).toBeVisible({ timeout: 30_000 });
  expect(app.url()).toBe(`${appsOrigin}/shop/`);
  await expect.poll(() => consoleLines.join('\n'), { timeout: 30_000 }).toContain('[vite] connected');

  // Hot reload through the proxied WebSocket.
  await page.bringToFront();
  await run(page, "cd /projects/shop/app && sed -i 's#<h1>.*</h1>#<h1>HMR works</h1>#' src/main.js", 'm8');
  await expect(app.locator('h1')).toHaveText('HMR works', { timeout: 30_000 });
  await shoot(context, `${appsOrigin}/shop/`, '08-apps', 'real-vite-app');

  // JavaScript on the app origin cannot read or act on the control plane.
  const read = await app.evaluate(async (cp) => {
    try {
      const r = await fetch(`${cp}/api/servers`, { credentials: 'include' });
      return `read ${r.status}`;
    } catch (e) {
      return `blocked ${(e as Error).name}`;
    }
  }, origin);
  expect(read).toMatch(/^blocked/);
  await app.evaluate(async (cp) => {
    await fetch(`${cp}/api/auth/logout`, { method: 'POST', credentials: 'include', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: 'x' }).catch(() => undefined);
  }, origin);
  expect((await page.request.get('/api/servers')).status(), 'still signed in after the cross-origin POST').toBe(200);

  // A signed-out visitor goes to sign-in.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`${appsOrigin}/shop/`);
  await expect(anonPage).toHaveURL(new RegExp(`^${origin}/login`));
  await anon.close();

  // 100 MB download while typing in a terminal: echo round trips stay fast.
  const download = app.evaluate(async (url) => {
    const t0 = performance.now();
    const r = await fetch(url);
    const reader = r.body!.getReader();
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
    }
    return { bytes: n, ms: Math.round(performance.now() - t0) };
  }, `${appsOrigin}/files/big.bin`);
  await page.bringToFront();
  const samples: number[] = [];
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now();
    await run(page, `echo probe${i}`, `p${i}`, 60_000);
    samples.push(Date.now() - t0);
  }
  const result = await download;
  console.log(`download ${result.bytes} bytes in ${result.ms} ms; terminal echo during download (ms): ${samples.join(', ')}`);
  expect(result.bytes).toBe(100 * 1024 * 1024);
  expect(Math.max(...samples)).toBeLessThan(5000);

  await run(page, 'daemons unexpose files; docker rm -f shopvite >/dev/null; pkill -f "http.serve[r] 8000"; rm -rf /projects/dl', 'm9');
});
