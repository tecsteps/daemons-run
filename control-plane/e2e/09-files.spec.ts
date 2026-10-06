import { expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { AGENT_CONTAINER, connectLocalAgent, sh } from './local-agent';
import { shoot, virtualPasskey } from './helpers';

test.skip(!AGENT_CONTAINER, 'needs AGENT_CONTAINER');

test('files: browse, edit and save, conflict, upload 50 MB intact, binary, download', async ({ page, context, baseURL }, info) => {
  await virtualPasskey(page, baseURL!);
  const origin = new URL(baseURL!).origin;
  await page.goto('/login');
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/servers/);
  const id = await connectLocalAgent(page, origin);
  sh(`rm -rf /projects/web && mkdir -p /projects/web && printf 'services:\\n  web:\\n    image: nginx\\n' > /projects/web/compose.yaml && head -c 3000 /dev/urandom > /projects/web/blob.bin && printf '\\x89PNG\\r\\n\\x1a\\n' > /projects/web/x.png`, 'dev');

  await page.goto(`/servers/${id}/files?path=/projects/web`);
  await expect(page.getByTestId('file-compose.yaml')).toBeVisible();
  await page.getByTestId('file-compose.yaml').click();
  await expect(page.getByTestId('files-editor')).toContainText('nginx');

  // Edit and save with Cmd/Ctrl+S; the server has the same bytes.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('    ports:\n      - "8080:80"\n');
  await expect(page.getByTestId('files-open-path')).toContainText('unsaved');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByTestId('files-open-path')).not.toContainText('unsaved');
  expect(sh('cat /projects/web/compose.yaml', 'dev')).toContain('"8080:80"');
  await shoot(context, `/servers/${id}/files?path=/projects/web`, '09-files', 'files');

  // A coding agent edits the file meanwhile: saving offers reload or overwrite.
  sh(`sleep 1; echo '# agent was here' >> /projects/web/compose.yaml`, 'dev');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('# mine\n');
  await page.getByTestId('files-save').click();
  await expect(page.getByTestId('conflict-reload')).toBeVisible();
  await page.getByTestId('conflict-reload').click();
  await expect(page.getByTestId('files-editor')).toContainText('agent was here');

  // Binary files show size and a download button, never garbage.
  await page.getByTestId('file-blob.bin').click();
  await expect(page.getByTestId('files-binary')).toContainText('binary');

  // Upload 50 MB; checksum matches on the server.
  const dir = info.outputDir;
  mkdirSync(dir, { recursive: true });
  const data = randomBytes(50 * 1024 * 1024);
  writeFileSync(`${dir}/big.dat`, data);
  const sum = createHash('sha256').update(data).digest('hex');
  await page.getByTestId('files-upload-input').setInputFiles(`${dir}/big.dat`);
  await expect(page.getByTestId('files-uploads')).toContainText('Uploaded', { timeout: 120_000 });
  expect(sh('sha256sum /projects/web/big.dat', 'dev').split(' ')[0]).toBe(sum);
  expect(sh('stat -c %U /projects/web/big.dat', 'root').trim()).toBe('dev');

  // Download a single file through the API: same bytes.
  const res = await page.request.get(`/api/servers/${id}/files/content?path=${encodeURIComponent('/projects/web/big.dat')}`);
  expect(createHash('sha256').update(await res.body()).digest('hex')).toBe(sum);
  // Folder as .tar.gz.
  const tgz = await page.request.get(`/api/servers/${id}/files/archive?path=/projects/web`);
  const bytes = await tgz.body();
  expect(bytes[0]).toBe(0x1f);
  expect(bytes[1]).toBe(0x8b);
  expect(bytes.length).toBeGreaterThan(50 * 1024 * 1024 * 0.9);

  // The dev user cannot read root's files.
  const denied = await page.request.get(`/api/servers/${id}/files?path=/root`);
  expect(denied.status()).toBeGreaterThanOrEqual(400);

  // Phone layout: list first, file opens full width.
  const mobile = await context.browser()!.newContext({ storageState: await context.storageState(), viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await mobile.newPage();
  await phone.goto(`/servers/${id}/files?path=/projects/web`);
  await phone.getByTestId('file-compose.yaml').tap();
  await expect(phone.getByTestId('files-editor')).toBeVisible();
  await phone.screenshot({ path: '../docs/qa/09-files/editor-phone-light.png' });
  await mobile.close();
  sh('rm -f /projects/web/big.dat', 'dev');
});
