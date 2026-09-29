import { expect, test, type Page } from '@playwright/test';

async function signUpWithProject(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Create Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Create ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
}

async function openCreate(page: Page) {
  await page.getByRole('button', { name: 'Create task' }).click();
  const create = page.getByRole('dialog', { name: 'New task' });
  // The columns load per project; the submit waits for them.
  await expect(create.getByRole('button', { name: 'Create task' })).toBeEnabled();
  return create;
}

async function pick(page: Page, dialog: ReturnType<Page['getByRole']>, field: string, option: string) {
  await dialog.getByLabel(field).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}

test('the create form sets every field before the task exists', async ({ page }) => {
  await signUpWithProject(page, 'create-full');
  const create = await openCreate(page);

  await create.getByLabel('Title').fill('Fully specified');
  await create.getByRole('textbox', { name: 'Description' }).fill('Written up front');
  await pick(page, create, 'Status', 'In Progress');
  await pick(page, create, 'Priority', 'High');

  await create.getByRole('button', { name: 'Add labels' }).click();
  await page.getByLabel('New label name').fill('backend');
  await page.getByLabel('New label name').press('Enter');
  await expect(page.getByRole('menuitem', { name: /backend/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(create.getByRole('button', { name: /backend/ })).toBeVisible();

  await create.getByRole('button', { name: 'Create task' }).click();
  await expect(create).toBeHidden();

  await expect(page.getByRole('region', { name: 'In Progress' }).getByText('Fully specified')).toBeVisible();

  await page.getByRole('button', { name: 'Open' }).click();
  const details = page.getByRole('dialog', { name: 'Task details' });
  await expect(details.getByLabel('Status')).toHaveText(/In Progress/);
  await expect(details.getByLabel('Priority')).toHaveText(/High/);
  await expect(details.getByText('Written up front')).toBeVisible();
  await expect(details.getByText('backend')).toBeVisible();
});

test('"Create another" keeps the form open for the next task', async ({ page }) => {
  await signUpWithProject(page, 'create-another');
  const create = await openCreate(page);

  await create.getByRole('switch', { name: 'Create another' }).click();
  await pick(page, create, 'Priority', 'Urgent');

  await create.getByLabel('Title').fill('First of many');
  await create.getByLabel('Title').press('Enter');
  await expect(page.getByText('Task created')).toBeVisible();

  // Still open, title cleared and focused, shared fields kept.
  await expect(create).toBeVisible();
  await expect(create.getByLabel('Title')).toHaveValue('');
  await expect(create.getByLabel('Title')).toBeFocused();
  await expect(create.getByLabel('Priority')).toHaveText(/Urgent/);

  await create.getByLabel('Title').fill('Second of many');
  await create.getByLabel('Title').press('Control+Enter');
  // Cleared again once the second one is saved.
  await expect(create.getByLabel('Title')).toHaveValue('');

  await page.keyboard.press('Escape');
  await expect(create).toBeHidden();
  const todo = page.getByRole('region', { name: 'Todo' });
  await expect(todo.getByText('First of many')).toBeVisible();
  await expect(todo.getByText('Second of many')).toBeVisible();
});
