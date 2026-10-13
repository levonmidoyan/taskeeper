import { expect, test, type Page } from '@playwright/test';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function signUpWithWorkspace(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Logo Tester');
  await page.getByLabel('Email', { exact: true }).fill(`logo-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Logo ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  return page.url();
}

test('an owner uploads a workspace icon, the switcher shows it, and removing it restores the initial', async ({ page }) => {
  const workspaceUrl = await signUpWithWorkspace(page);
  const railLogo = page.getByRole('navigation', { name: 'Workspace' }).locator('img');

  await page.goto(`${workspaceUrl}/settings/general`);
  await expect(railLogo).toHaveCount(0);

  await page.getByLabel('Workspace icon').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Workspace icon updated.')).toBeVisible();
  await expect(railLogo).toHaveAttribute('src', /^data:image\/webp;base64,/);

  await page.reload();
  await expect(railLogo).toHaveCount(1);

  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Workspace icon removed.')).toBeVisible();
  await expect(railLogo).toHaveCount(0);
});
