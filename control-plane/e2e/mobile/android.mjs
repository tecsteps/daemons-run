// Final mobile check on the Android emulator (Chrome), against daemons-dev and a real server.
//   node e2e/mobile/android.mjs <server-name>
// Against the local control plane and the agent container (adb reverse maps the port):
//   BASE_URL=http://localhost:8787 node e2e/mobile/android.mjs box
// Optional parts: SKIP_AGENTS=1 skips the OpenCode and Claude Code sections.
// The emulator has no Google account, so passkeys cannot be created there: the session is
// signed in on desktop Chromium (virtual passkey) and its cookie handed to Android Chrome.
import { _android, chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? 'https://daemons-dev.fabian-wesner.workers.dev';
const SERVER = process.argv[2] ?? 'dev-arm-1';
const OUT = join(here, '..', '..', '..', 'docs', 'qa', '06-terminal');
mkdirSync(OUT, { recursive: true });
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' });
const log = (...a) => console.log('•', ...a);

// 1. Desktop sign-in with the stored virtual passkey.
const desktop = await chromium.launch();
const dctx = await desktop.newContext();
const dpage = await dctx.newPage();
const cdp = await dctx.newCDPSession(dpage);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
const credFile = join(here, '..', '.auth', `${new URL(BASE).hostname}.json`);
if (!existsSync(credFile)) throw new Error('no stored passkey for this control plane; run the 01-02 suite first');
for (const c of JSON.parse(readFileSync(credFile, 'utf8'))) {
  await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: { ...c, signCount: Math.floor(Date.now() / 1000) } });
}
await dpage.goto(`${BASE}/login`);
await dpage.getByTestId('sign-in').click();
await dpage.waitForURL(/\/servers/);
const cookies = (await dctx.cookies()).filter((c) => c.name.startsWith('__Host-daemons'));
const { servers } = await (await dpage.request.get(`${BASE}/api/servers`)).json();
const server = servers.find((s) => s.name === SERVER);
if (server?.status !== 'online') throw new Error(`${SERVER} is not online`);
await desktop.close();
log('desktop signed in; server', server.id);

// 2. Android Chrome with that session.
const [device] = await _android.devices();
if (new URL(BASE).hostname === 'localhost') adb('reverse', `tcp:${new URL(BASE).port || 80}`, `tcp:${new URL(BASE).port || 80}`);
adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
adb('shell', 'settings', 'put', 'system', 'user_rotation', '0');
await device.shell('am force-stop com.android.chrome');
const context = await device.launchBrowser();
await context.addCookies(cookies);
const page = await context.newPage();
const shot = async (name) => {
  await page.waitForTimeout(800);
  await device.screenshot({ path: join(OUT, `android-${name}.png`) });
  log('screenshot', name);
};
const term = () => page.evaluate(() => window.__daemonsTerminal?.() ?? '');
const termState = () => page.evaluate(() => window.__daemonsTerminalState?.());
// Rows in the visible viewport (tmux's screen; or xterm's viewport with an older agent).
const rowsOnScreen = async () => {
  const { viewportY, rows } = await termState();
  const visible = (await term()).split('\n').slice(viewportY, viewportY + rows).join('\n');
  return [...visible.matchAll(/^row-(\d+)$/gm)].map((m) => Number(m[1]));
};

// Real touches through adb. Calibrate once: where does a screen tap land in CSS pixels?
let calib = null;
async function calibrate() {
  const size = /(\d+)x(\d+)/.exec(adb('shell', 'wm', 'size'))?.slice(1).map(Number);
  await page.evaluate(() => {
    window.__lastTouch = null;
    addEventListener('touchstart', (e) => (window.__lastTouch = [e.touches[0].clientX, e.touches[0].clientY]), { capture: true, once: true });
  });
  const sx = Math.round(size[0] / 2);
  const sy = Math.round(size[1] / 2);
  adb('shell', 'input', 'tap', String(sx), String(sy));
  await page.waitForTimeout(500);
  const touch = await page.evaluate(() => window.__lastTouch);
  if (!touch) throw new Error('calibration tap did not reach the page');
  const [cx, cy] = touch;
  const dpr = await page.evaluate(() => devicePixelRatio);
  calib = { dpr, ox: sx - cx * dpr, oy: sy - cy * dpr };
  log('calibration', calib);
}
// Typing through the on-screen keyboard's input connection (adb input text / keyevent).
function typeText(text) {
  for (const part of text.split(/( )/)) {
    if (part === ' ') adb('shell', 'input', 'keyevent', '62');
    else if (part) adb('shell', 'input', 'text', part.replace(/([;&|<>()$`\\"'*?~])/g, '\\$1'));
  }
}
const enter = () => adb('shell', 'input', 'keyevent', '66');
async function tap(locator) {
  if (!calib) await calibrate();
  const b = await locator.boundingBox();
  if (!b) throw new Error('not visible: ' + locator);
  adb('shell', 'input', 'tap', String(Math.round(calib.ox + (b.x + b.width / 2) * calib.dpr)), String(Math.round(calib.oy + (b.y + b.height / 2) * calib.dpr)));
  await page.waitForTimeout(400);
}

// A real finger drag through adb, in CSS pixels of the page.
async function swipe(x, y1, y2, ms = 400) {
  if (!calib) await calibrate();
  const px = (v, o) => String(Math.round(o + v * calib.dpr));
  adb('shell', 'input', 'swipe', px(x, calib.ox), px(y1, calib.oy), px(x, calib.ox), px(y2, calib.oy), String(ms));
  await page.waitForTimeout(700);
}

await page.goto(`${BASE}/servers`);
await expect(page.getByRole('heading', { name: 'Servers', exact: true })).toBeVisible();
await shot('servers');

// 3. Terminal: tap to focus, the on-screen keyboard opens, the prompt stays visible.
await page.goto(`${BASE}/servers/${server.id}/terminal?s=android&cwd=/projects`);
await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
const screenBefore = await page.evaluate(() => window.visualViewport.height);
for (let i = 0; i < 3; i++) {
  await tap(page.getByTestId('terminal'));
  await page.waitForTimeout(1500);
  if ((await page.evaluate(() => window.visualViewport.height)) < screenBefore - 150) break;
}
const vv = await page.evaluate(() => ({ vv: window.visualViewport.height, inner: window.innerHeight }));
log('viewport with keyboard', vv, 'screen height before', screenBefore);
expect(vv.vv).toBeLessThan(screenBefore - 150);
const keyRow = await page.getByTestId('terminal-key-row').boundingBox();
const frame = await page.getByTestId('terminal-page').boundingBox();
log('key row bottom', keyRow.y + keyRow.height, 'frame', frame);
expect(keyRow.y + keyRow.height).toBeLessThanOrEqual(vv.vv + 2);

// Typing through the real IME (adb input text goes through the keyboard).
typeText('echo typed-on-android');
enter();
await expect.poll(term, { timeout: 15_000 }).toContain('typed-on-android');
await shot('terminal-keyboard');

// Sticky Ctrl from the key row + "c" from the keyboard interrupts a running command.
typeText('sleep 300');
enter();
await tap(page.getByTestId('terminal-key-ctrl'));
typeText('c');
typeText('echo after-interrupt');
enter();
await expect.poll(term, { timeout: 15_000 }).toContain('after-interrupt');
// Arrow up from the key row recalls the last command.
await tap(page.getByTestId('terminal-key-up'));
enter();
await expect.poll(async () => (await term()).split('after-interrupt').length, { timeout: 15_000 }).toBeGreaterThan(3);
log('ctrl+c and history ok');

// Scrollback by touch: 300 lines, swipe down to scroll up through tmux history (copy mode).
typeText('seq -f row-%g 1 300');
enter();
await expect.poll(rowsOnScreen, { timeout: 15_000 }).toContain(300);
await tap(page.getByTestId('terminal-key-hide'));
await page.waitForTimeout(800);
const box = await page.getByTestId('terminal').boundingBox();
log('terminal state', await termState());
await swipe(box.x + box.width / 2, box.y + 80, box.y + box.height - 40);
await expect.poll(async () => Math.max(0, ...(await rowsOnScreen())), { timeout: 10_000 }).toBeLessThan(300);
const scrolledTo = Math.min(...(await rowsOnScreen()));
await swipe(box.x + box.width / 2, box.y + 80, box.y + box.height - 40);
await expect.poll(async () => Math.min(...(await rowsOnScreen())), { timeout: 10_000 }).toBeLessThan(scrolledTo);
log('scrolled back to row', Math.min(...(await rowsOnScreen())));
await shot('terminal-scrollback');
// Swipe up scrolls forward again; typing leaves copy mode and reaches the shell.
await swipe(box.x + box.width / 2, box.y + box.height - 40, box.y + 80);
await tap(page.getByTestId('terminal'));
typeText('echo out-of-history');
enter();
await expect.poll(term, { timeout: 15_000 }).toMatch(/^out-of-history$/m);
log('typing left copy mode');

// Select sheet: the scrollback as native selectable text.
await tap(page.getByTestId('terminal-key-select'));
await expect(page.getByTestId('terminal-select-text')).toContainText('after-interrupt');
expect(await page.getByTestId('terminal-select-text').textContent()).toMatch(/^row-1$/m);
await shot('terminal-select');
await page.keyboard.press('Escape');
await tap(page.getByRole('button', { name: 'Close' })).catch(() => undefined);

// Rotate: landscape keeps the session and redraws.
const portrait = calib;
adb('shell', 'settings', 'put', 'system', 'user_rotation', '1');
await page.waitForTimeout(2500);
calib = null;
await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
log('landscape overflow', overflow, await page.evaluate(() => [innerWidth, innerHeight]));
await shot('terminal-landscape');
adb('shell', 'settings', 'put', 'system', 'user_rotation', '0');
await page.waitForTimeout(2000);
calib = portrait;

// Background Chrome, come back: the session reattaches.
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
await new Promise((r) => setTimeout(r, 15_000));
adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main');
await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
await page.waitForTimeout(1500);
await tap(page.getByTestId('terminal'));
typeText('echo back-again');
enter();
await expect.poll(term, { timeout: 15_000 }).toContain('back-again');
await shot('terminal-after-background');
log('background and return ok');

if (!process.env.SKIP_AGENTS) {
  // OpenCode (harness opencode: the wheel sends its transcript page keys). A free model, no login.
  const oc = `oc${Date.now().toString(36).slice(-4)}`;
  await page.goto(`${BASE}/servers/${server.id}/terminal?s=${oc}&cwd=/projects&command=opencode`);
  await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
  await expect.poll(async () => (await termState())?.harness, { timeout: 15_000 }).toBe('opencode');
  await page.waitForTimeout(8000);
  await tap(page.getByTestId('terminal'));
  typeText('Write a numbered list from 1 to 60, each line: the number and one short sentence about the sea.');
  enter();
  await expect.poll(async () => /\b5[0-9]\.\s/.test(await term()), { timeout: 180_000, intervals: [3000] }).toBe(true);
  await page.waitForTimeout(5000);
  await tap(page.getByTestId('terminal-key-hide'));
  await page.waitForTimeout(800);
  await shot('opencode');
  const ocBox = await page.getByTestId('terminal').boundingBox();
  const firstNumber = async () => Math.min(...[...(await term()).matchAll(/^\W*(\d{1,2})\.\s/gm)].map((m) => Number(m[1])));
  const before = await firstNumber();
  for (let i = 0; i < 3; i++) await swipe(ocBox.x + ocBox.width / 2, ocBox.y + 120, ocBox.y + ocBox.height - 60, 300);
  await expect.poll(firstNumber, { timeout: 10_000 }).toBeLessThan(before);
  log('opencode transcript scrolled from item', before, 'to', await firstNumber());
  await shot('opencode-scrolled');
  for (let i = 0; i < 3; i++) await swipe(ocBox.x + ocBox.width / 2, ocBox.y + ocBox.height - 60, ocBox.y + 120, 300);

  // Claude Code without login: its screen renders and the session survives a reload.
  const cc = `cc${Date.now().toString(36).slice(-4)}`;
  await page.goto(`${BASE}/servers/${server.id}/terminal?s=${cc}&cwd=/projects&command=claude`);
  await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
  await expect.poll(async () => (await termState())?.harness, { timeout: 15_000 }).toBe('claude');
  await expect.poll(async () => (await term()).replace(/\s+/g, ' ').trim().length, { timeout: 30_000 }).toBeGreaterThan(40);
  await page.waitForTimeout(3000);
  await shot('claude-code');
  log('claude screen', (await term()).split('\n').filter((l) => l.trim()).slice(0, 6).join(' | '));
  await page.reload();
  await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
  const { sessions } = await page.evaluate((u) => fetch(u).then((r) => r.json()), `/api/servers/${server.id}/terminals`);
  expect(sessions.map((x) => x.name)).toContain(cc);
  await expect.poll(async () => (await term()).trim().length, { timeout: 15_000 }).toBeGreaterThan(40);
  await shot('claude-code-reattached');
  for (const name of [oc, cc]) await page.evaluate((u) => fetch(u, { method: 'DELETE' }), `/api/servers/${server.id}/terminals/${name}`);
}

for (const path of ['/projects', '/apps', '/settings']) {
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(1500);
  await shot(path.slice(1));
}
await context.close();
await device.close();
log('ANDROID CHECK PASSED');
