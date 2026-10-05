import { expect, test, type Page } from '@playwright/test';

async function signUpWithProject(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Api Tester');
  await page.getByLabel('Email', { exact: true }).fill(`api-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Api ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Project name').fill('Web');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);

  const [, slug, projectId] = /\/([^/]+)\/projects\/([^/?]+)/.exec(new URL(page.url()).pathname)!;
  return { slug, projectId };
}

test('a token made in settings drives the API until it is revoked', async ({ page }) => {
  const { slug, projectId } = await signUpWithProject(page);

  await page.goto('/settings/api-tokens');
  await page.getByRole('button', { name: 'New token' }).click();
  const dialog = page.getByRole('dialog', { name: 'New API token' });
  await dialog.getByLabel('Name').fill('e2e');
  await dialog.getByRole('button', { name: 'Create token' }).click();
  const token = await dialog.getByLabel('Your new token').inputValue();
  expect(token).toMatch(/^tk_[0-9A-Za-z]{43}$/);
  await dialog.getByRole('button', { name: 'Done' }).click();

  const auth = { Authorization: `Bearer ${token}` };
  const created = await page.request.post(`/api/v1/workspaces/${slug}/tasks`, {
    headers: auth, data: { projectId, title: 'Made by the API' },
  });
  expect(created.status()).toBe(201);

  await page.goto(`/${slug}/projects/${projectId}/list`);
  await expect(page.getByText('Made by the API')).toBeVisible();

  await page.goto('/settings/api-tokens');
  await page.getByRole('button', { name: 'Revoke e2e' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('e2e revoked.')).toBeVisible();

  // The browser's session cookie rides along on page.request; the API must ignore it.
  const after = await page.request.get('/api/v1/me', { headers: auth });
  expect(after.status()).toBe(401);
});

test('the API reference is public and lists the task endpoints', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/docs/api');
  await expect(page.getByRole('heading', { name: 'API reference' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create a task' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'List tasks' })).toBeVisible();

  const spec = await page.request.get('/api/v1/openapi.json');
  expect(spec.status()).toBe(200);
  expect((await spec.json()).openapi).toBe('3.1.0');
});
