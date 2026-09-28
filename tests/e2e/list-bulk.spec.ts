import { expect, test, type Page } from '@playwright/test';
import { createTask } from './tasks';

async function signUpWithListTasks(page: Page, titles: string[]) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('List Tester');
  await page.getByLabel('Email', { exact: true }).fill(`list-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`List ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'List' }).click();
  await expect(page).toHaveURL(/\/list$/);

  for (const title of titles) {
    await createTask(page, title);
    await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  }
}

function row(page: Page, title: string) {
  return page.getByRole('row').filter({ has: page.getByRole('button', { name: title, exact: true }) });
}

test('bulk-sets the status of the selected rows', async ({ page }) => {
  await signUpWithListTasks(page, ['Alpha', 'Beta', 'Gamma']);

  await page.getByLabel('Select Alpha').check();
  // Shift-click selects the range from the anchor, Beta included.
  await page.getByLabel('Select Gamma').click({ modifiers: ['Shift'] });

  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await expect(bar).toContainText('3 selected');

  await bar.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('menuitem', { name: 'Done' }).click();

  await expect(page.getByText('Updated 3 tasks')).toBeVisible();
  for (const title of ['Alpha', 'Beta', 'Gamma']) {
    await expect(row(page, title)).toContainText('Done');
  }

  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
});

test('bulk-deletes the selected rows', async ({ page }) => {
  await signUpWithListTasks(page, ['Keep', 'Drop one', 'Drop two']);

  await page.getByLabel('Select Drop one').check();
  await page.getByLabel('Select Drop two').check();

  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete 2 tasks?' });
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.getByText('Deleted 2 tasks')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Drop one', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Keep', exact: true })).toBeVisible();
});

test('row menu changes one task without opening it', async ({ page }) => {
  await signUpWithListTasks(page, ['Solo']);

  await row(page, 'Solo').hover();
  await page.getByRole('button', { name: 'Actions for Solo' }).click();
  await page.getByRole('menuitem', { name: 'Priority' }).click();
  await page.getByRole('menuitem', { name: 'Urgent' }).click();

  await expect(row(page, 'Solo')).toContainText('Urgent');
  await expect(page).not.toHaveURL(/task=/);
});
