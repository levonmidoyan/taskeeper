import { expect, test, type Page } from '@playwright/test';
import { createTask } from './tasks';

async function signUpWithProject(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Keys Tester');
  await page.getByLabel('Email', { exact: true }).fill(`keys-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByLabel('Workspace name').fill(`Keys ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
  // Keys pressed while the dialog is still closing belong to it, not to the board.
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('board: j focuses, o opens, j/k step, i assigns, Escape returns focus', async ({ page }) => {
  await signUpWithProject(page);
  await createTask(page, 'First');
  await createTask(page, 'Second');

  // Cards are ordered by creation within the first column.
  await page.keyboard.press('j');
  const first = page.getByRole('button', { name: 'First', exact: true });
  await expect(first).toBeFocused();
  await page.keyboard.press('j');
  await expect(page.getByRole('button', { name: 'Second', exact: true })).toBeFocused();
  await page.keyboard.press('k');
  await expect(first).toBeFocused();

  await page.keyboard.press('o');
  const dialog = page.getByRole('dialog', { name: 'Task details' });
  await expect(dialog.getByLabel('Title')).toHaveValue('First');

  await page.keyboard.press('j');
  await expect(dialog.getByLabel('Title')).toHaveValue('Second');

  // Typing in the title never fires shortcuts.
  await dialog.getByLabel('Title').click();
  await page.keyboard.type(' jk');
  await expect(dialog.getByLabel('Title')).toHaveValue('Second jk');
  await expect(page).toHaveURL(/task=/);
  await dialog.focus();

  await page.keyboard.press('i');
  await expect(dialog.getByLabel('Assignee')).toContainText('Keys Tester');

  // s opens the Status list; j inside it belongs to the list, not to task stepping.
  await page.keyboard.press('s');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('j');
  // The open Select hides the dialog from the accessibility tree, so find the title by id.
  await expect(page.locator('#task-title')).toHaveValue('Second jk');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();

  // After picking with the keyboard, the next letter is a shortcut again and
  // never the Status trigger's typeahead ("d" would otherwise pick Done).
  await page.keyboard.press('s');
  await expect(page.getByRole('option', { name: 'Todo' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'In Progress' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page.locator('#task-status')).toContainText('In Progress');
  await page.keyboard.press('d');
  await expect(page.locator('[data-radix-popper-content-wrapper]')).toBeVisible();
  await expect(page.locator('#task-status')).toContainText('In Progress');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-radix-popper-content-wrapper]')).toBeHidden();

  // A confirm owns the keys: j does not step the task behind it.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.locator('#task-title')).toHaveValue('Second jk');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/[?&]task=/);
  // The card's name now ends with its assignee.
  await expect(page.getByRole('button', { name: /^Second jk/ })).toBeFocused();
});

test('g chords move between views and ? lists the shortcuts', async ({ page }) => {
  await signUpWithProject(page);

  await page.keyboard.press('g');
  await page.keyboard.press('l');
  await expect(page).toHaveURL(/\/projects\/[^/]+\/list/);

  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await expect(page).toHaveURL(/\/projects\/[^/?]+(\?|$)/);

  await page.keyboard.press('g');
  await page.keyboard.press('t');
  await expect(page).toHaveURL(/\/todo/);

  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help.getByText('Assign to me')).toBeVisible();
});
