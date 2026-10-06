import { expect, test, type Page } from '@playwright/test';
import { AGENT_CONTAINER, connectLocalAgent, sh } from './local-agent';
import { shoot, virtualPasskey } from './helpers';

test.skip(!AGENT_CONTAINER, 'needs AGENT_CONTAINER (a Docker container with daemons-agent)');

async function screenText(page: Page) {
  return page.evaluate(() => (window as unknown as { __daemonsTerminal?: () => string }).__daemonsTerminal?.() ?? '');
}

async function typeInTerminal(page: Page, text: string) {
  await page.locator('[data-testid="terminal"] .xterm-helper-textarea').focus();
  await page.keyboard.type(text);
}

test('terminal: start, type, survive a reload, tabs, phone key row', async ({ page, context, baseURL }) => {
  await virtualPasskey(page, baseURL!);
  const origin = new URL(baseURL!).origin;
  await page.goto('/login');
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/servers/);
  const id = await connectLocalAgent(page, origin);
  sh("tmux -L daemons kill-server 2>/dev/null || true", 'dev');

  if (process.env.DEBUG_WS) page.on('console', (m) => console.log('console', m.text()));
  if (process.env.DEBUG_WS) page.on('websocket', (ws) => {
    ws.on('framesent', (f) => console.log('sent', typeof f.payload === 'string' ? f.payload : `bin ${[...f.payload].slice(0, 12)}`));
    ws.on('framereceived', (f) => console.log('recv', typeof f.payload === 'string' ? f.payload : `bin ${f.payload.length}`));
    ws.on('close', () => console.log('ws closed'));
  });
  await page.goto(`/servers/${id}/terminal`);
  await expect(page.getByTestId('terminal-quick-start')).toBeVisible();
  await shoot(context, `/servers/${id}/terminal`, '06-terminal', 'quick-start');
  await page.getByTestId('quick-shell').click();
  await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected');
  await typeInTerminal(page, 'echo hello-$((40+2)) && pwd\n');
  await expect.poll(() => screenText(page)).toContain('hello-42');
  expect(await screenText(page)).toContain('/projects');

  // A long-running process survives closing the page.
  await typeInTerminal(page, 'for i in $(seq 1 1000); do echo tick-$i; sleep 1; done\n');
  await expect.poll(() => screenText(page)).toContain('tick-2');
  await page.reload();
  await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected');
  const lastTick = async () => Math.max(0, ...[...(await screenText(page)).matchAll(/tick-(\d+)/g)].map((m) => Number(m[1])));
  const before = await lastTick();
  await expect.poll(lastTick).toBeGreaterThan(before + 1);
  expect(sh('tmux -L daemons ls', 'dev')).toContain('shell');
  await page.locator('[data-testid="terminal"] .xterm-helper-textarea').focus();
  await page.keyboard.press('Control+C');
  await typeInTerminal(page, 'echo stopped\n');
  await expect.poll(() => screenText(page)).toContain('stopped');
  const stoppedAt = await lastTick();
  await page.waitForTimeout(2500);
  expect(await lastTick()).toBe(stoppedAt);

  // Full-screen TUI with box drawing.
  await typeInTerminal(page, "printf '\\e[32m┌──┐\\e[0m\\n│ok│\\n└──┘\\n'\n");
  await expect.poll(() => screenText(page)).toContain('┌──┐');
  await shoot(context, `/servers/${id}/terminal?s=shell`, '06-terminal', 'shell', async (p) => {
    await expect(p.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected');
    await p.waitForTimeout(800);
  });

  // Second tab, rename, close.
  await page.getByTestId('terminal-new').click();
  await expect(page.getByTestId('terminal-tab-shell-2')).toBeVisible();
  await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected');
  await page.getByTestId('terminal-tab-shell').click();
  await expect.poll(() => screenText(page)).toContain('│ok│');

  // Phone: key row, Ctrl latch + c sends ^C, arrows recall history.
  const mobile = await context.browser()!.newContext({
    storageState: await context.storageState(),
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const phone = await mobile.newPage();
  await phone.goto(`/servers/${id}/terminal?s=shell`);
  await expect(phone.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected');
  await expect(phone.getByTestId('terminal-key-row')).toBeVisible();
  await phone.locator('[data-testid="terminal"] .xterm-helper-textarea').focus();
  await phone.keyboard.type('sleep 100');
  await phone.keyboard.press('Enter');
  await phone.getByTestId('terminal-key-ctrl').tap();
  await phone.keyboard.type('c');
  await phone.keyboard.type('echo after-ctrl-c\n');
  await expect.poll(() => screenText(phone)).toContain('after-ctrl-c');
  await phone.getByTestId('terminal-key-up').tap();
  await phone.keyboard.press('Enter');
  await expect.poll(async () => (await screenText(phone)).split('after-ctrl-c').length).toBeGreaterThan(3);
  await phone.getByTestId('terminal-key-select').tap();
  await expect(phone.getByTestId('terminal-select-text')).toContainText('after-ctrl-c');
  await phone.screenshot({ path: '../docs/qa/06-terminal/select-phone-dark.png' });
  await mobile.close();
});
