import { expect, test, type Page } from '@playwright/test';
import { createTask } from './tasks';

async function signUpAndOpenTask(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Detail Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Detail ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await createTask(page, 'Look at me');
  await page.getByRole('button', { name: 'Look at me', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Task details' });
  await expect(dialog.getByLabel('Title')).toHaveValue('Look at me');
  return dialog;
}

test('the description is a preview until clicked; Save keeps, Cancel and Escape discard', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'description');
  const editor = dialog.getByRole('textbox', { name: 'Description' });

  await expect(editor).toBeHidden();
  await dialog.getByRole('button', { name: 'Add a description…' }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.type('First draft');
  await dialog.getByRole('button', { name: 'Save' }).click();

  const preview = dialog.getByTestId('description-preview');
  await expect(preview).toHaveText('First draft');
  await expect(editor).toBeHidden();

  // Escape ends the edit without saving, and leaves the dialog open.
  await preview.click();
  await expect(editor).toBeFocused();
  await page.keyboard.type(' and more');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(preview).toHaveText('First draft');

  await dialog.getByRole('button', { name: 'Edit' }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.type(' again');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(preview).toHaveText('First draft');

  // Ctrl+Enter saves, and the save survives a reload.
  await preview.click();
  await expect(editor).toBeFocused();
  await page.keyboard.type(', final');
  // The preview shows the text before the save lands; reloading earlier drops it.
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/projects/'));
  await page.keyboard.press('Control+Enter');
  await expect(preview).toHaveText('First draft, final');
  await saved;
  await page.reload();
  await expect(dialog.getByTestId('description-preview')).toHaveText('First draft, final');
});

test('the subtask input appears on request and Escape puts the button back', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'subtask-input');
  const input = dialog.getByPlaceholder('Add a subtask…');

  await expect(input).toBeHidden();
  await dialog.getByRole('button', { name: 'Add subtask' }).click();
  await expect(input).toBeFocused();
  await input.fill('One');
  await input.press('Enter');
  await expect(dialog.getByRole('button', { name: 'One', exact: true })).toBeVisible();
  // Still open, ready for the next one.
  await expect(input).toBeFocused();

  await input.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(input).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Add subtask' })).toBeFocused();
});

test('sections collapse and stay collapsed on the next task', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'collapse');
  const header = dialog.getByRole('button', { name: 'Activity' });

  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.getByRole('textbox', { name: 'Comment' })).toBeHidden();

  await page.reload();
  await expect(dialog.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-expanded', 'false');
  await dialog.getByRole('button', { name: 'Activity' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Comment' })).toBeVisible();
});

test('the newest comment shows first, under the composer', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'newest');

  for (const body of ['Older one', 'Newer one']) {
    await dialog.getByRole('textbox', { name: 'Comment' }).fill(body);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('listitem').getByText(body)).toBeVisible();
  }

  const comments = dialog.getByRole('listitem').filter({ hasText: /one$/ });
  await expect(comments.first()).toContainText('Newer one');
  await expect(comments.last()).toContainText('Older one');
});
