import { expect, test } from '@playwright/test';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

test('a new user signs up, creates a workspace, and adds a task', async ({ page }) => {
  const email = uniqueEmail('signup');

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Ada Lovelace');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/new-workspace/);
  await page.getByLabel('Workspace name').fill('Acme Corp');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/acme-corp/);

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByPlaceholder('Add a task…').fill('Ship the landing page');
  await page.getByPlaceholder('Add a task…').press('Enter');

  await expect(page.getByText('Ship the landing page')).toBeVisible();
});

test('a workspace slug the user does not belong to returns 404', async ({ page }) => {
  const email = uniqueEmail('outsider');

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Outsider');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/new-workspace/);
  await page.getByLabel('Workspace name').fill('Outsider Space');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/outsider-space/);

  // The slug from the first test exists but belongs to someone else.
  const response = await page.goto('/acme-corp');
  expect(response?.status()).toBe(404);
});
