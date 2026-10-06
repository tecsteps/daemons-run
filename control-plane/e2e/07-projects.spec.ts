import { expect, test } from '@playwright/test';
import { AGENT_CONTAINER, connectLocalAgent, sh } from './local-agent';
import { shoot, virtualPasskey } from './helpers';

test.skip(!AGENT_CONTAINER, 'needs AGENT_CONTAINER');

test('projects: folders in /projects, new, clone, open terminal here, delete', async ({ page, context, baseURL }) => {
  await virtualPasskey(page, baseURL!);
  const origin = new URL(baseURL!).origin;
  await page.goto('/login');
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/servers/);
  await connectLocalAgent(page, origin);
  sh('rm -rf /projects/foo /projects/hello /projects/blank /projects/shop', 'dev');

  // A folder made in a terminal shows up on refresh.
  sh('mkdir -p /projects/foo', 'dev');
  await page.goto('/projects');
  await expect(page.getByTestId('project-foo')).toBeVisible();

  // Clone a public repository.
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-git').fill('https://github.com/octocat/Hello-World.git');
  await expect(page.getByTestId('project-name')).toHaveValue('Hello-World');
  await page.getByTestId('project-name').fill('hello');
  await page.getByTestId('project-create').click();
  await expect(page).toHaveURL(/\/terminal\?s=hello/, { timeout: 60_000 });
  await expect(page.getByTestId('terminal-status')).toHaveAttribute('data-state', 'connected');
  await page.locator('[data-testid="terminal"] .xterm-helper-textarea').focus();
  await page.keyboard.type('pwd; git log --oneline | head -1\n');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __daemonsTerminal?: () => string }).__daemonsTerminal?.() ?? ''))
    .toContain('/projects/hello');

  // A private or missing repository says what to do.
  await page.goto('/projects');
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-git').fill('https://github.com/tecsteps/does-not-exist-xyz.git');
  await page.getByTestId('project-name').fill('nope');
  await page.getByTestId('project-create').click();
  await expect(page.getByRole('alert')).toContainText('gh auth login');
  await page.keyboard.press('Escape');

  await page.goto('/projects');
  await expect(page.getByTestId('project-hello')).toContainText('master');
  await shoot(context, '/projects', '07-projects', 'projects', async (p) => {
    await p.getByTestId('project-hello').waitFor();
  });

  // Delete: typed name, folder gone, nothing else touched.
  await page.getByRole('button', { name: 'Delete foo' }).click();
  await page.getByTestId('confirm-name').fill('foo');
  await page.getByTestId('confirm-destructive').click();
  await expect(page.getByTestId('project-foo')).toHaveCount(0);
  expect(sh('ls /projects', 'dev')).toContain('hello');
  expect(sh('ls /projects', 'dev')).not.toContain('foo');
});
