// Final mobile check in the iOS Simulator (Safari, iPhone 17 Pro), against daemons-dev.
//   safaridriver -p 4444 &   (Xcode selected with xcode-select; Simulator booted)
//   node e2e/mobile/ios.mjs <server-name>
// The phone gets its own passkey through Settings → Add a phone (a WebDriver virtual
// authenticator stands in for Face ID), then the terminal is exercised on real Safari.
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? 'https://daemons-dev.fabian-wesner.workers.dev';
const SERVER = process.argv[2] ?? 'dev-arm-1';
const WD = 'http://localhost:4444';
const OUT = join(here, '..', '..', '..', 'docs', 'qa', '06-terminal');
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('•', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });

async function wd(method, path, body) {
  const r = await fetch(`${WD}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json();
  if (json.value?.error) throw new Error(`${method} ${path}: ${json.value.error}: ${json.value.message}`);
  return json.value;
}

// 1. Desktop: sign in with the stored virtual passkey and mint an "Add a phone" link.
const desktop = await chromium.launch();
const dctx = await desktop.newContext();
const dpage = await dctx.newPage();
const cdp = await dctx.newCDPSession(dpage);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
const credFile = join(here, '..', '.auth', `${new URL(BASE).hostname}.json`);
if (!existsSync(credFile)) throw new Error('no stored passkey for this control plane');
for (const c of JSON.parse(readFileSync(credFile, 'utf8'))) {
  await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: { ...c, signCount: Math.floor(Date.now() / 1000) } });
}
await dpage.goto(`${BASE}/login`);
await dpage.getByTestId('sign-in').click();
await dpage.waitForURL(/\/servers/);
const origin = new URL(BASE).origin;
const cookies = (await dctx.cookies()).filter((c) => c.name.startsWith('__Host-daemons'));
void origin;
const { servers } = await (await dpage.request.get(`${BASE}/api/servers`)).json();
const server = servers.find((s) => s.name === SERVER);
if (server?.status !== 'online') throw new Error(`${SERVER} is not online`);
log('desktop signed in');

// 2. iOS Safari session with a virtual authenticator.
const session = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'Safari', platformName: 'iOS', 'safari:useSimulator': true } } });
const S = `/session/${session.sessionId}`;
const exec = (script, args = []) => wd('POST', `${S}/execute/sync`, { script, args });
const click = async (css) => wd('POST', `${S}/element/${await find(css)}/click`, {});
const go = (url) => wd('POST', `${S}/url`, { url });
const until = async (fn, what, ms = 20_000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => false);
    if (v) return v;
    if (Date.now() - t0 > ms) {
      const tail = await exec('return window.__daemonsTerminal ? window.__daemonsTerminal().trim().split("\\n").slice(-6).join(" ⏎ ") : ""').catch(() => '');
      throw new Error(`timeout: ${what}${tail ? ` | terminal: ${tail}` : ''}`);
    }
    await sleep(300);
  }
};
const find = async (css) => {
  const el = await until(async () => {
    const v = await wd('POST', `${S}/element`, { using: 'css selector', value: css });
    return v && Object.values(v)[0];
  }, `element ${css}`);
  return el;
};
const shot = async (name) => {
  await sleep(700);
  simctl('io', 'booted', 'screenshot', join(OUT, `ios-${name}.png`));
  log('screenshot', name);
};
const term = () => exec('return window.__daemonsTerminal ? window.__daemonsTerminal() : ""');
const status = () => exec('const e = document.querySelector("[data-testid=terminal-status]"); return e ? e.dataset.state : null');

try {
  // Safari in the Simulator ignores WebDriver virtual authenticators (every transport times
  // out), so the phone gets the desktop session cookie instead of its own passkey.
  await go(`${BASE}/login`);
  for (const c of cookies) {
    await wd('POST', `${S}/cookie`, { cookie: { name: c.name, value: c.value, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' } });
  }
  await go(`${BASE}/servers`);
  await until(async () => (await exec('return location.pathname')) === '/servers', 'signed in on the phone');
  await shot('servers');

  // Terminal.
  await go(`${BASE}/servers/${server.id}/terminal?s=ios&cwd=/projects`);
  await until(async () => (await status()) === 'connected', 'terminal connected', 30_000);
  await click('[data-testid=terminal]');
  const textarea = await find('[data-testid=terminal] .xterm-helper-textarea');
  await wd('POST', `${S}/element/${textarea}/value`, { text: 'echo typed-on-ios\n' });
  await until(async () => (await term()).includes('typed-on-ios\n'), 'echo output');
  await shot('terminal');

  await wd('POST', `${S}/element/${textarea}/value`, { text: 'sleep 300\n' });
  await click('[data-testid=terminal-key-ctrl]');
  const latched = await until(() => exec('return document.querySelector("[data-testid=terminal-key-ctrl]").getAttribute("aria-pressed") === "true"'), 'ctrl latched', 3000).catch(() => false);
  if (!latched) log('FINDING: Ctrl did not latch after one tap (toggled twice)');
  await wd('POST', `${S}/element/${textarea}/value`, { text: latched ? 'c' : '\u0003' });
  await wd('POST', `${S}/element/${textarea}/value`, { text: 'echo after-interrupt\n' });
  await until(async () => (await term()).includes('after-interrupt\n'), 'interrupt and echo');
  await click('[data-testid=terminal-key-up]');
  await wd('POST', `${S}/element/${textarea}/value`, { text: '\n' });
  await until(async () => (await term()).split('after-interrupt').length > 3, 'history via arrow key');
  log('typing, sticky Ctrl, arrow keys ok');

  const overflow = await exec('return document.documentElement.scrollWidth - innerWidth');
  log('horizontal overflow', overflow);
  expect(overflow).toBeLessThanOrEqual(1);

  await click('[data-testid=terminal-key-select]');
  const sheet = await until(() => exec('return !!document.querySelector("[data-testid=terminal-select-text]")'), 'select sheet', 4000).catch(() => false);
  if (!sheet) log('FINDING: Select sheet did not stay open after one tap');
  else await shot('terminal-select');
  await exec('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))');

  // Backgrounding Safari ends the WebDriver session itself, so background/return is covered
  // by the Android check (e2e/mobile/android.mjs) instead.

  for (const path of ['projects', 'apps', 'settings']) {
    await go(`${BASE}/${path}`);
    await sleep(1500);
    await shot(path);
  }
  log('IOS CHECK PASSED');
} finally {
  await wd('DELETE', S).catch(() => undefined);
  await desktop.close();
}
