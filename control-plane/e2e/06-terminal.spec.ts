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

  // tmux owns the history: the wheel scrolls it (copy mode), typing leaves copy mode and reaches the shell.
  await typeInTerminal(page, 'clear; seq -f row-%g 1 300\n');
  await expect.poll(() => screenText(page)).toMatch(/^row-300$/m);
  const box = (await page.getByTestId('terminal').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const visibleRows = () => screenText(page).then((t) => [...t.matchAll(/^row-(\d+)$/gm)].map((m) => Number(m[1])));
  for (let i = 0; i < 20 && (await visibleRows()).includes(300); i++) {
    await page.mouse.wheel(0, -60);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500); // let the last wheel reports reach tmux
  const rows = await visibleRows();
  expect(rows.length).toBeGreaterThan(5);
  expect(Math.max(...rows)).toBeLessThan(300);
  expect(sh("tmux -L daemons display -p -t '=shell:' '#{pane_in_mode}'", 'dev').trim()).toBe('1');
  await typeInTerminal(page, 'echo left-copy-mode\n');
  await expect.poll(() => screenText(page)).toMatch(/^left-copy-mode$/m);
  expect(sh("tmux -L daemons display -p -t '=shell:' '#{pane_in_mode}'", 'dev').trim()).toBe('0');

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
  // Touch: a drag down scrolls tmux history; a pinch zooms; a tap on a link offers Open/Copy.
  const touch = await mobile.newCDPSession(phone);
  const tbox = (await phone.getByTestId('terminal').boundingBox())!;
  const cx = tbox.x + tbox.width / 2;
  const drag = async (points: { x: number; y: number }[][]) => {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points[0].map((p, id) => ({ ...p, id })) });
    for (const step of points.slice(1)) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: step.map((p, id) => ({ ...p, id })) });
      await phone.waitForTimeout(16);
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await phone.getByTestId('terminal-key-hide').tap();
  await phone.locator('[data-testid="terminal"] .xterm-helper-textarea').focus();
  await phone.keyboard.type('seq -f row-%g 1 300\n');
  await expect.poll(() => screenText(phone)).toMatch(/^row-300$/m);
  await drag(Array.from({ length: 20 }, (_, i) => [{ x: cx, y: tbox.y + 60 + i * 20 }]));
  await expect.poll(() => screenText(phone)).not.toMatch(/^row-300$/m);
  await phone.screenshot({ path: '../docs/qa/06-terminal/scroll-phone-dark.png' });
  await phone.keyboard.type('x');
  await expect.poll(() => sh("tmux -L daemons display -p -t '=shell:' '#{pane_in_mode}'", 'dev').trim()).toBe('0');
  await phone.keyboard.press('Backspace');
  const fontBefore = await phone.evaluate(() => (window as unknown as { __daemonsTerminalState: () => { fontSize: number } }).__daemonsTerminalState().fontSize);
  await drag(Array.from({ length: 10 }, (_, i) => [{ x: cx - 30 - i * 8, y: tbox.y + 200 }, { x: cx + 30 + i * 8, y: tbox.y + 200 }]));
  const fontAfter = await phone.evaluate(() => (window as unknown as { __daemonsTerminalState: () => { fontSize: number } }).__daemonsTerminalState().fontSize);
  expect(fontAfter).toBeGreaterThan(fontBefore);
  await phone.keyboard.type('echo https://example.com/daemons-link\n');
  // After the pinch the URL may wrap onto two rows; the link still covers both.
  await expect.poll(() => screenText(phone)).toMatch(/^https:\/\/example.com\/daemons/m);
  const linkRow = (await screenText(phone)).split('\n').findIndex((l) => l.startsWith('https://example.com/daemons'));
  const state = await phone.evaluate(() => (window as unknown as { __daemonsTerminalState: () => { rows: number } }).__daemonsTerminalState());
  const screenBox = (await phone.locator('[data-testid="terminal"] .xterm-screen').boundingBox())!;
  await phone.touchscreen.tap(screenBox.x + 30, screenBox.y + (linkRow + 0.5) * (screenBox.height / state.rows));
  await expect(phone.getByTestId('terminal-link-url')).toHaveText('https://example.com/daemons-link');
  await phone.keyboard.press('Escape');

  // Select: tmux history as selectable text, beyond the visible screen.
  await phone.getByTestId('terminal-key-select').tap();
  await expect(phone.getByTestId('terminal-select-text')).toContainText('after-ctrl-c');
  expect(await phone.getByTestId('terminal-select-text').textContent()).toMatch(/^row-1$/m);
  await phone.screenshot({ path: '../docs/qa/06-terminal/select-phone-dark.png' });
  await mobile.close();
});
