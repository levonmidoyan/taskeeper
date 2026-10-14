import { expect, test, type Page } from '@playwright/test';

async function signUpWithWorkspace(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Mobile Tester');
  await page.getByLabel('Email', { exact: true }).fill(`mobile-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Mobile ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/mobile-${stamp}$`));
  return page.url();
}

async function newProject(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
}

async function newTask(page: Page, title: string) {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'New task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill(title);
  const submit = dialog.getByRole('button', { name: 'Create task' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog).toBeHidden();
}

test('bottom bar: navigation, new task, search, inbox', async ({ page }) => {
  await signUpWithWorkspace(page);
  const bar = page.getByRole('navigation', { name: 'Primary' });
  await expect(bar).toBeVisible();

  await newProject(page, 'Phone');
  await newTask(page, 'Buy milk');

  await bar.getByRole('link', { name: 'To-do' }).click();
  await expect(page).toHaveURL(/\/todo$/);
  await expect(bar.getByRole('link', { name: 'To-do' })).toHaveAttribute('aria-current', 'page');

  await bar.getByRole('button', { name: 'Search' }).click();
  await page.getByPlaceholder('Search tasks, projects and pages').fill('milk');
  await expect(page.getByRole('option', { name: /Buy milk/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await bar.getByRole('link', { name: /Inbox/ }).click();
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect(page.getByText('Nothing yet.')).toBeVisible();
});

test('the bottom bar never covers the last list row or the bulk bar', async ({ page }) => {
  await signUpWithWorkspace(page);
  await newProject(page, 'Long');
  for (let i = 1; i <= 12; i++) await newTask(page, `Row ${i}`);
  await page.getByRole('tab', { name: 'List' }).click();
  await expect(page).toHaveURL(/\/list$/);
  const last = page.getByRole('button', { name: 'Row 12', exact: true });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.getByRole('dialog', { name: 'Task details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/[?&]task=/);

  await page.getByLabel('Select Row 1', { exact: true }).check();
  const bulk = page.getByRole('toolbar', { name: 'Bulk actions' });
  await expect(bulk).toBeVisible();
  const barBox = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
  const bulkBox = await bulk.boundingBox();
  expect(bulkBox!.y + bulkBox!.height).toBeLessThanOrEqual(barBox!.y);
});
