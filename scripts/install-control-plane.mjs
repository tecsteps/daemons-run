#!/usr/bin/env node
// Installs or updates daemons.run in your Cloudflare account (specs/03, path B).
//
//   npm run install-control-plane                 # Workers `daemons` + `daemons-apps`
//   npm run install-control-plane -- --name daemons-dev
//   npm run reset-access                          # new setup code: revokes all passkeys on use
//
// Safe to rerun: it reuses the D1 database, keeps data and secrets, and updates in place.

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const name = option('name', 'daemons');
const appsName = name.startsWith('daemons') ? `daemons-apps${name.slice('daemons'.length)}` : `${name}-apps`;
const resetAccess = flag('reset-access');
const wranglerBin = [join(root, 'node_modules', '.bin', 'wrangler'), join(root, 'control-plane', 'node_modules', '.bin', 'wrangler')].find(existsSync);
if (!wranglerBin) {
  console.error('✗ Run `npm install` in the repository first.');
  process.exit(1);
}

function step(text) {
  console.log(`\n→ ${text}`);
}

function fail(text) {
  console.error(`\n✗ ${text}`);
  process.exit(1);
}

function wrangler(argv, { input, cwd = join(root, 'control-plane'), quiet = false } = {}) {
  const result = spawnSync(wranglerBin, argv, {
    cwd,
    input,
    encoding: 'utf8',
    stdio: [input === undefined ? 'inherit' : 'pipe', quiet ? 'pipe' : 'inherit', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) fail(`wrangler could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    if (/not authenticated|wrangler login|Authentication error|code: 10000/i.test(stderr)) {
      fail('Wrangler is not signed in. Run `npx wrangler login` in control-plane/, then run this again.');
    }
    fail(`wrangler ${argv.join(' ')} failed:\n${stderr}`);
  }
  return result.stdout ?? '';
}

function stripJsonc(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}

/** A token for the Cloudflare API: CLOUDFLARE_API_TOKEN, or wrangler's own OAuth login. */
function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  for (const dir of [join(homedir(), 'Library', 'Preferences', '.wrangler'), join(homedir(), '.config', '.wrangler'), join(homedir(), '.wrangler')]) {
    const file = join(dir, 'config', 'default.toml');
    if (existsSync(file)) {
      const match = /oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(file, 'utf8'));
      if (match) return match[1];
    }
  }
  return null;
}

async function cf(path, init = {}) {
  const token = apiToken();
  if (!token) return null;
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  return response.json().catch(() => null);
}

async function accountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const accounts = await cf('/accounts');
  if (accounts?.result?.length === 1) return accounts.result[0].id;
  if (accounts?.result?.length > 1) {
    fail(`Your Cloudflare login has several accounts. Set CLOUDFLARE_ACCOUNT_ID to one of:\n${accounts.result.map((a) => `  ${a.id}  ${a.name}`).join('\n')}`);
  }
  return null;
}

/** Refuses to overwrite a Worker with this name that is not a daemons.run control plane. */
async function checkCollision(account, worker, marker) {
  if (!account) return;
  const settings = await cf(`/accounts/${account}/workers/scripts/${worker}/settings`);
  if (!settings?.success) return; // does not exist yet
  const bindings = settings.result?.bindings ?? [];
  const ours = bindings.some((b) => b[marker.key] === marker.value);
  if (!ours) fail(`A Worker named "${worker}" already exists in this account and is not a daemons.run install. Choose another name with --name.`);
}

async function main() {
  step(`Installing daemons.run as Worker "${name}" (apps gateway "${appsName}")`);
  wrangler(['whoami'], { quiet: true });
  const account = await accountId();
  if (account) process.env.CLOUDFLARE_ACCOUNT_ID = account;
  await checkCollision(account, name, { key: 'class_name', value: 'ServerConnection' });
  await checkCollision(account, appsName, { key: 'service', value: name });

  step('D1 database');
  const list = JSON.parse(wrangler(['d1', 'list', '--json'], { quiet: true }) || '[]');
  let db = list.find((d) => d.name === name);
  if (!db) {
    wrangler(['d1', 'create', name], { quiet: true });
    db = JSON.parse(wrangler(['d1', 'list', '--json'], { quiet: true })).find((d) => d.name === name);
    if (!db) fail('The D1 database could not be created.');
    console.log(`  created ${name} (${db.uuid})`);
  } else {
    console.log(`  reusing ${name} (${db.uuid})`);
  }

  // A local config with this account's IDs; the committed wrangler.jsonc stays ID-free.
  const base = stripJsonc(readFileSync(join(root, 'control-plane', 'wrangler.jsonc'), 'utf8'));
  base.name = name;
  base.d1_databases = [{ ...base.d1_databases[0], database_name: name, database_id: db.uuid }];
  const config = join(root, 'control-plane', `wrangler.${name}.local.jsonc`);
  writeFileSync(config, JSON.stringify(base, null, 2));

  step('Building the UI');
  execFileSync('npm', ['run', 'build', '-w', 'control-plane'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });

  step('Migrations');
  wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '-c', config], { quiet: true, input: 'y\n' });

  step('Deploying the control plane');
  const deployed = wrangler(['deploy', '-c', config], { quiet: true });
  const url = /https:\/\/[^\s]+\.workers\.dev/.exec(deployed)?.[0];
  if (!url) fail(`Deployed, but no workers.dev URL was printed. Enable workers.dev for "${name}" in the Cloudflare dashboard.\n${deployed}`);
  console.log(`  ${url}`);

  step('Deploying the apps gateway');
  const gatewayBase = stripJsonc(readFileSync(join(root, 'apps-gateway', 'wrangler.jsonc'), 'utf8'));
  gatewayBase.name = appsName;
  gatewayBase.services = [{ ...gatewayBase.services[0], service: name }];
  delete gatewayBase.$schema;
  const gatewayConfig = join(root, 'apps-gateway', `wrangler.${appsName}.local.jsonc`);
  writeFileSync(gatewayConfig, JSON.stringify(gatewayBase, null, 2));
  const gatewayOut = wrangler(['deploy', '-c', gatewayConfig], { quiet: true, cwd: join(root, 'apps-gateway') });
  console.log(`  ${/https:\/\/[^\s]+\.workers\.dev/.exec(gatewayOut)?.[0] ?? '(deployed)'}`);

  step('Setup code');
  const secrets = JSON.parse(wrangler(['secret', 'list', '-c', config, '--format', 'json'], { quiet: true }) || '[]');
  const hasCode = secrets.some((s) => s.name === 'SETUP_CODE');
  if (hasCode && !resetAccess) {
    console.log('  already set (kept). To get a new one: npm run reset-access' + (name === 'daemons' ? '' : ` -- --name ${name}`));
    console.log(`\n✓ Updated. Open ${url}`);
    return;
  }
  const code = randomBytes(15).toString('base64url');
  wrangler(['secret', 'put', 'SETUP_CODE', '-c', config], { input: code, quiet: true });
  const link = `${url}/setup#code=${code}`;
  if (process.env.DAEMONS_SETUP_CODE_FILE) writeFileSync(process.env.DAEMONS_SETUP_CODE_FILE, code, { mode: 0o600 });
  console.log(
    resetAccess
      ? '\n✓ New setup code set. Completing setup with it revokes every other passkey and session.'
      : '\n✓ Installed.',
  );
  console.log(`\nOpen this link to register your passkey (it works once):\n\n  ${link}\n`);
}

main().catch((error) => fail(error.stack ?? String(error)));
