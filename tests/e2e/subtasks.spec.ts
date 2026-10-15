import { expect, test, type Page } from '@playwright/test';
import { createTask } from './tasks';

async function signUpAndOpenTask(page: Page, prefix: string, title = 'Launch') {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Subtask Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByLabel('Workspace name').fill(`Subtasks ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
  await createTask(page, title);
  await page.getByRole('button', { name: title, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Task details' });
  await expect(dialog.getByLabel('Title')).toHaveValue(title);
  return dialog;
}

async function addSubtasks(page: Page, titles: string[]) {
  const input = page.getByRole('dialog').getByPlaceholder('Add subtask…');
  for (const t of titles) {
    await input.fill(t);
    await input.press('Enter');
    await expect(page.getByRole('dialog').getByRole('button', { name: `Rename “${t}”` })).toBeVisible();
  }
}

test('an opened subtask names its parent and steps between siblings', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'siblings');
  await addSubtasks(page, ['One', 'Two', 'Three']);

  await dialog.getByRole('button', { name: 'Open “Two”' }).click();
  await expect(dialog.getByLabel('Title')).toHaveValue('Two');
  await expect(dialog.getByText('Subtask of')).toBeVisible();
  await expect(dialog.getByText('2 of 3')).toBeVisible();

  await dialog.getByRole('button', { name: 'Next subtask' }).click();
  await expect(dialog.getByLabel('Title')).toHaveValue('Three');
  await expect(dialog.getByRole('button', { name: 'Next subtask' })).toBeDisabled();

  // Shortcuts, with focus on the dialog body rather than a field.
  await dialog.getByText('Subtask of').click();
  await page.keyboard.press('[');
  await expect(dialog.getByLabel('Title')).toHaveValue('Two');
  await page.keyboard.press('u');
  await expect(dialog.getByLabel('Title')).toHaveValue('Launch');
});

test('a task becomes a subtask of another and back, with Undo', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'convert', 'Launch');
  await page.keyboard.press('Escape');
  await createTask(page, 'Write copy');
  await page.getByRole('button', { name: 'Write copy', exact: true }).click();

  await dialog.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Make subtask of…' }).click();
  const picker = page.getByRole('dialog', { name: 'Make subtask of…' });
  await picker.getByRole('combobox').fill('Lau');
  await picker.getByRole('option', { name: 'Launch' }).click();

  await expect(page.getByText('“Write copy” is now a subtask of “Launch”')).toBeVisible();
  await expect(dialog.getByText('Subtask of')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(dialog.getByText('Subtask of')).toBeHidden();

  // And promote from the parent's row menu.
  await dialog.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Make subtask of…' }).click();
  await picker.getByRole('option', { name: 'Launch' }).click();
  await dialog.getByRole('button', { name: 'Launch', exact: true }).click();
  await dialog.getByRole('button', { name: 'More for “Write copy”' }).click();
  await page.getByRole('menuitem', { name: 'Promote to task' }).click();
  await expect(dialog.getByRole('button', { name: 'Rename “Write copy”' })).toBeHidden();
});

test('a board card expands its subtasks; ticking one updates the count without opening the card', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'board-checklist');
  await addSubtasks(page, ['One', 'Two']);
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/[?&]task=/);

  const toggle = page.getByRole('button', { name: 'Subtasks of Launch' });
  await expect(toggle).toHaveText(/0\/2/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Mark “One” as done' }).click();
  await expect(toggle).toHaveText(/1\/2/);
  await expect(page).not.toHaveURL(/[?&]task=/);

  await page.getByRole('button', { name: 'Two', exact: true }).click();
  await expect(dialog.getByLabel('Title')).toHaveValue('Two');
});
