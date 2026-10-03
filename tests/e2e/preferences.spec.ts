import { expect, test, type Page } from '@playwright/test';

async function signUpWithWorkspace(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Zone Tester');
  await page.getByLabel('Email', { exact: true }).fill(`prefs-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Prefs ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  return page.url();
}

test('a personal timezone is saved and leaves the workspace timezone alone', async ({ page }) => {
  const workspaceUrl = await signUpWithWorkspace(page);

  await page.goto('/settings/preferences');
  const zone = page.getByLabel('Your timezone');
  await expect(zone).toHaveText('Follow each workspace’s timezone');

  await zone.click();
  await page.getByRole('option', { name: 'Europe/Berlin' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Timezone updated.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Your timezone')).toHaveText('Europe/Berlin');

  // The owner has an override, but the workspace form must show the workspace's zone.
  await page.goto(`${workspaceUrl}/settings/general`);
  await expect(page.getByLabel('Workspace timezone')).toHaveText('Asia/Yerevan');

  await page.goto('/settings/preferences');
  await page.getByLabel('Your timezone').click();
  await page.getByRole('option', { name: 'Follow each workspace’s timezone' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Timezone updated.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Your timezone')).toHaveText('Follow each workspace’s timezone');
});
