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

test('the list expands a parent into indented subtask rows', async ({ page }) => {
  await signUpAndOpenTask(page, 'list-children');
  await addSubtasks(page, ['One', 'Two']);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'List' }).click();

  const chevron = page.getByRole('table').getByRole('button', { name: 'Subtasks of Launch' });
  await chevron.click();
  await expect(chevron).toHaveAttribute('aria-expanded', 'true');
  const table = page.getByRole('table');
  await expect(table.getByRole('button', { name: 'One', exact: true })).toBeVisible();
  await expect(table.getByRole('button', { name: 'Two', exact: true })).toBeVisible();

  await table.getByRole('button', { name: 'Two', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Task details' }).getByLabel('Title')).toHaveValue('Two');
});

test('subtasks reorder by keyboard and the order survives a reload and a done toggle', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'reorder');
  await addSubtasks(page, ['One', 'Two', 'Three']);
  const titles = dialog.getByRole('list', { name: 'Subtasks' }).getByRole('button', { name: /^Rename/ });

  await dialog.getByRole('button', { name: 'Rename “Three”' }).focus();
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.keyboard.press('Alt+ArrowUp');
  await saved;
  await expect(titles).toHaveText(['One', 'Three', 'Two']);

  await dialog.getByRole('button', { name: 'Mark “One” as done' }).click();
  await expect(dialog.getByText('1/3')).toBeVisible();
  await expect(titles).toHaveText(['One', 'Three', 'Two']);

  await page.reload();
  await expect(titles).toHaveText(['One', 'Three', 'Two']);
});

test('row fields change status, assignee and due date in place', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'row-fields');
  await addSubtasks(page, ['Step']);

  await dialog.getByRole('button', { name: /^Status: / }).click();
  await page.getByRole('menuitem', { name: 'In Progress' }).click();
  await expect(dialog.getByRole('button', { name: 'Status: In Progress' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Assign “Step”' }).click();
  await page.getByRole('option', { name: /Subtask Tester/ }).click();
  await expect(dialog.getByRole('button', { name: 'Assignee: Subtask Tester' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Set due date' }).click();
  await page.getByRole('menuitem', { name: 'Tomorrow' }).click();
  await expect(dialog.getByRole('button', { name: /^Due date: / })).toBeVisible();
});

test('lifting a card with its checklist open keeps the cards below in place', async ({ page }) => {
  await signUpAndOpenTask(page, 'drag-expanded');
  await addSubtasks(page, ['One', 'Two']);
  await page.keyboard.press('Escape');
  await createTask(page, 'Below');
  const todo = page.getByRole('region', { name: 'Todo' });
  await todo.getByRole('button', { name: 'Subtasks of Launch' }).click();
  await expect(todo.getByRole('button', { name: 'One', exact: true })).toBeVisible();

  const below = todo.getByRole('button', { name: 'Below', exact: true });
  const before = (await below.boundingBox())!;
  const box = (await todo.getByRole('button', { name: 'Launch', exact: true }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 5 });
  await page.waitForTimeout(300);
  const during = (await below.boundingBox())!;
  await page.mouse.up();
  expect(Math.abs(during.y - before.y)).toBeLessThan(2);
});
