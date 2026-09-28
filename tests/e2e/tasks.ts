import { expect, type Page } from '@playwright/test';

/**
 * Adds a task through the header's Create dialog, the only way in now that the
 * board and list have no quick add. `status` picks its column in the form;
 * otherwise it lands in the project's first one. The dialog closes and the
 * view refreshes behind it.
 */
export async function createTask(page: Page, title: string, status?: string) {
  await page.getByRole('button', { name: 'Create task' }).click();
  const create = page.getByRole('dialog', { name: 'New task' });
  await create.getByLabel('Title').fill(title);
  // The columns load per project; the submit waits for them.
  const submit = create.getByRole('button', { name: 'Create task' });
  await expect(submit).toBeEnabled();

  if (status) {
    await create.getByLabel('Status').click();
    await page.getByRole('option', { name: status, exact: true }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
  }

  await submit.click();
  await expect(create).toBeHidden();
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
