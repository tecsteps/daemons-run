import { describe, expect, it } from 'vitest';
import { appsOrigin, controlPlaneOriginFromApps } from '../src/worker/origins';
import { constantTimeEqual, fromBase64url, base64url, sha256 } from '../src/worker/crypto';
import { frame, parseFrame, rewriteLocation } from '../src/worker/server-connection';
import { passkeyName } from '../src/worker/auth';
import { APP_NAME } from '../src/worker/apps';
import { userData, installCommand, SERVER_NAME } from '../src/worker/servers';
import type { Env } from '../src/worker/env';

const env = {} as Env;

describe('origins', () => {
  it('maps the control plane to its apps gateway and back', () => {
    expect(appsOrigin(env, 'https://daemons.acme.workers.dev/x')).toBe('https://daemons-apps.acme.workers.dev');
    expect(appsOrigin(env, 'https://daemons-dev.acme.workers.dev')).toBe('https://daemons-apps-dev.acme.workers.dev');
    expect(controlPlaneOriginFromApps(env, 'https://daemons-apps-dev.acme.workers.dev/shop/')).toBe('https://daemons-dev.acme.workers.dev');
    expect(controlPlaneOriginFromApps(env, 'https://daemons-apps.acme.workers.dev/')).toBe('https://daemons.acme.workers.dev');
  });
  it('honours explicit overrides', () => {
    expect(appsOrigin({ APPS_ORIGIN: 'https://apps.example.com/' } as Env, 'https://x.example.com')).toBe('https://apps.example.com');
  });
});

describe('crypto', () => {
  it('round-trips base64url and compares in constant time', async () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 62, 63]);
    expect([...fromBase64url(base64url(bytes))]).toEqual([...bytes]);
    expect(await constantTimeEqual('abc', 'abc')).toBe(true);
    expect(await constantTimeEqual('abc', 'abd')).toBe(false);
    expect(await constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(await sha256('x')).toHaveLength(43);
  });
});

describe('frames', () => {
  it('encodes kind and channel big endian', () => {
    const f = frame(0x02, 258, new Uint8Array([7, 8]));
    expect([...f]).toEqual([2, 0, 0, 1, 2, 7, 8]);
    const parsed = parseFrame(f.buffer as ArrayBuffer);
    expect(parsed.kind).toBe(2);
    expect(parsed.channel).toBe(258);
    expect([...parsed.payload]).toEqual([7, 8]);
  });
});

describe('proxy rules', () => {
  it('rewrites Location headers that point at the app port', () => {
    const base = 'https://daemons-apps.acme.workers.dev/shop';
    expect(rewriteLocation('http://localhost:3000/shop/login', 3000, base)).toBe(`${base}/shop/login`);
    expect(rewriteLocation('http://127.0.0.1:3000/', 3000, base)).toBe(`${base}/`);
    expect(rewriteLocation('http://localhost:4000/x', 3000, base)).toBe('http://localhost:4000/x');
    expect(rewriteLocation('/shop/next', 3000, base)).toBe('/shop/next');
    expect(rewriteLocation('https://github.com/login', 3000, base)).toBe('https://github.com/login');
  });
});

describe('names and commands', () => {
  it('validates app and server names', () => {
    expect(APP_NAME.test('shop')).toBe(true);
    expect(APP_NAME.test('my-shop-2')).toBe(true);
    expect(APP_NAME.test('-shop')).toBe(false);
    expect(APP_NAME.test('Shop')).toBe(false);
    expect(SERVER_NAME.test('web-1')).toBe(true);
    expect(SERVER_NAME.test('a'.repeat(33))).toBe(false);
  });
  it('names passkeys after the device', () => {
    expect(passkeyName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari/604.1')).toBe('iPhone · Safari');
    expect(passkeyName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140 Safari/537.36')).toBe('Mac · Chrome');
  });
  it('fills cloud-init and the install command without leaking into other places', () => {
    const data = userData('https://cp.example', 'TOKEN123', ['claude', 'codex']);
    expect(data).toContain('https://cp.example');
    expect(data).toContain('TOKEN123');
    expect(data).not.toContain('__');
    expect(installCommand('https://cp.example', 'T', ['claude'])).toBe('curl -fsSL https://cp.example/install.sh | sudo DAEMONS_TOKEN=T DAEMONS_AGENTS="claude" sh');
  });
});

describe('installer copies', () => {
  it('match installer/ (run npm run sync-installer -w control-plane)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['install.sh', 'cloud-init.yaml.tmpl']) {
      expect(readFileSync(new URL(`../src/worker/generated/${f}`, import.meta.url), 'utf8')).toBe(
        readFileSync(new URL(`../../installer/${f}`, import.meta.url), 'utf8'),
      );
    }
  });
});
