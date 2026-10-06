// Final mobile check on the Android emulator (Chrome), against daemons-dev and a real server.
//   node e2e/mobile/android.mjs <server-name>
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

await page.goto(`${BASE}/servers`);
await expect(page.getByRole('heading', { name: 'Servers', exact: true })).toBeVisible();
await shot('servers');

// 3. Terminal: tap to focus, the on-screen keyboard opens, the prompt stays visible.
await page.goto(`${BASE}/servers/${server.id}/terminal?s=android&cwd=/projects`);
await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
await page.getByTestId('terminal').tap();
await page.waitForTimeout(1500);
const vv = await page.evaluate(() => ({ vv: window.visualViewport.height, inner: window.innerHeight }));
log('viewport with keyboard', vv);
if (vv.inner - vv.vv < 100) log('WARN: keyboard did not shrink the visual viewport');
const keyRow = await page.getByTestId('terminal-key-row').boundingBox();
const frame = await page.getByTestId('terminal-page').boundingBox();
log('key row bottom', keyRow.y + keyRow.height, 'frame', frame);
expect(keyRow.y + keyRow.height).toBeLessThanOrEqual(vv.vv + 2);

// Typing through the real IME (adb input text goes through the keyboard).
await device.input.type('echo typed-on-android');
await device.input.press('Enter');
await expect.poll(term, { timeout: 15_000 }).toContain('typed-on-android');
await shot('terminal-keyboard');

// Sticky Ctrl from the key row + "c" from the keyboard interrupts a running command.
await device.input.type('sleep 300');
await device.input.press('Enter');
await page.getByTestId('terminal-key-ctrl').tap();
await device.input.type('c');
await device.input.type('echo after-interrupt');
await device.input.press('Enter');
await expect.poll(term, { timeout: 15_000 }).toContain('after-interrupt');
// Arrow up from the key row recalls the last command.
await page.getByTestId('terminal-key-up').tap();
await device.input.press('Enter');
await expect.poll(async () => (await term()).split('after-interrupt').length, { timeout: 15_000 }).toBeGreaterThan(3);
log('ctrl+c and history ok');

// Scrollback by touch: 300 lines, swipe down to scroll up.
await device.input.type('seq 1 300');
await device.input.press('Enter');
await expect.poll(term, { timeout: 15_000 }).toContain('\n300');
await page.getByTestId('terminal-key-hide').tap();
await page.waitForTimeout(800);
const before = await page.evaluate(() => document.querySelector('.xterm-viewport').scrollTop);
const box = await page.getByTestId('terminal').boundingBox();
await device.input.swipe({ x: box.x + box.width / 2, y: box.y + 80 }, [{ x: box.x + box.width / 2, y: box.y + box.height - 40 }], 10);
await page.waitForTimeout(800);
const after = await page.evaluate(() => document.querySelector('.xterm-viewport').scrollTop);
log('scrollTop before/after swipe', before, after);
await shot('terminal-scrollback');

// Select sheet: the scrollback as native selectable text.
await page.getByTestId('terminal-key-select').tap();
await expect(page.getByTestId('terminal-select-text')).toContainText('after-interrupt');
await shot('terminal-select');
await page.keyboard.press('Escape');
await page.locator('[role="dialog"] button').first().tap().catch(() => undefined);

// Claude Code's full-screen TUI renders.
await page.getByTestId('terminal').tap();
await device.input.type('clear; claude');
await device.input.press('Enter');
await page.waitForTimeout(6000);
await page.getByTestId('terminal-key-hide').tap();
await shot('claude-code');
log('claude screen', (await term()).split('\n').filter((l) => l.trim()).slice(0, 6).join(' | '));
await page.getByTestId('terminal-key-ctrl').tap();
await device.input.type('c');
await page.getByTestId('terminal-key-ctrl').tap();
await device.input.type('c');

// Rotate: landscape keeps the session and redraws.
adb('shell', 'settings', 'put', 'system', 'user_rotation', '1');
await page.waitForTimeout(2500);
await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
log('landscape overflow', overflow, await page.evaluate(() => [innerWidth, innerHeight]));
await shot('terminal-landscape');
adb('shell', 'settings', 'put', 'system', 'user_rotation', '0');
await page.waitForTimeout(2000);

// Background Chrome, come back: the session reattaches.
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
await new Promise((r) => setTimeout(r, 15_000));
adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main');
await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
await page.getByTestId('terminal').tap();
await device.input.type('echo back-again');
await device.input.press('Enter');
await expect.poll(term, { timeout: 15_000 }).toContain('back-again');
await shot('terminal-after-background');
log('background and return ok');

for (const path of ['/projects', '/apps', '/settings']) {
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(1500);
  await shot(path.slice(1));
}
await context.close();
await device.close();
log('ANDROID CHECK PASSED');
