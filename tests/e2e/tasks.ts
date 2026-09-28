import { expect, type Page } from '@playwright/test';

/**
 * Adds a task through the header's Create dialog, the only way in now that the
 * board and list have no quick add. It lands in the project's first column and
 * opens the task's detail dialog; `status` picks another column from there
 * before the dialog is closed again.
 *
 * A status change keeps the task's position, and positions are keyed per
 * column, so a task created after another has left Todo can tie with it. Create
 * every task first, then move them, when the order inside a column matters.
 */
export async function createTask(page: Page, title: string, status?: string) {
  await page.getByRole('button', { name: 'Create task' }).click();
  const create = page.getByRole('dialog', { name: 'New task' });
  await create.getByLabel('Title').fill(title);
  await create.getByRole('button', { name: 'Create task' }).click();
  await expect(page).toHaveURL(/[?&]task=/);

  if (status) await setStatus(page, status);
  await closeTask(page);
}

/** Moves the task open in the detail dialog to another column. */
export async function setStatus(page: Page, status: string) {
  const details = page.getByRole('dialog', { name: 'Task details' });
  await details.getByLabel('Status').click();
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/projects/'),
  );
  await page.getByRole('option', { name: status, exact: true }).click();
  // An Escape sent while the listbox is still closing goes to the select, not
  // the dialog, and closeTask would then wait on a dialog that stays open.
  await expect(page.getByRole('listbox')).toBeHidden();
  await saved;
}

export async function closeTask(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/[?&]task=/);
}
