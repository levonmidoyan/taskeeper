import { expect, test, type Page } from '@playwright/test';

async function signUpWithProject(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Search Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByLabel('Workspace name').fill(`Search ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
  // The dialog stays open until the new project page loads; ⌘K is ignored over it.
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function createTaskWithDescription(page: Page, title: string, description: string) {
  await page.getByRole('button', { name: 'Create task' }).click();
  const create = page.getByRole('dialog', { name: 'New task' });
  await create.getByLabel('Title').fill(title);
  await create.getByRole('textbox', { name: 'Description' }).fill(description);
  const submit = create.getByRole('button', { name: 'Create task' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(create).toBeHidden();
}

const palette = (page: Page) => page.getByRole('dialog', { name: 'Search' });

test('⌘K finds a task by a word prefix in its description', async ({ page }) => {
  await signUpWithProject(page, 'search-desc');
  await createTaskWithDescription(page, 'Release checklist', 'Run the staging migration first.');

  await page.keyboard.press('ControlOrMeta+k');
  await palette(page).getByRole('combobox').fill('migra');

  const hit = palette(page).getByRole('option', { name: /Release checklist/ });
  await expect(hit).toBeVisible();
  await expect(hit.locator('mark')).toHaveText('migration');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/tasks\//);
  await expect(palette(page)).toBeHidden();
});

test('the header button and "/" open the palette; ⌘K toggles it', async ({ page }) => {
  await signUpWithProject(page, 'search-open');

  // exact: the workspace switcher's name also starts with "Search".
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();

  await page.keyboard.press('/');
  await expect(palette(page)).toBeVisible();
  // ⌘K again closes it.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toBeHidden();
});

test('⌘K does nothing while another dialog is open', async ({ page }) => {
  await signUpWithProject(page, 'search-over');
  await page.getByRole('button', { name: 'Create task' }).click();
  const create = page.getByRole('dialog', { name: 'New task' });
  await create.getByLabel('Title').focus();

  await page.keyboard.press('ControlOrMeta+k');

  await expect(palette(page)).toBeHidden();
  await expect(create).toBeVisible();
});

test('the New task action opens the create dialog with focus inside it', async ({ page }) => {
  await signUpWithProject(page, 'search-new');

  await page.keyboard.press('ControlOrMeta+k');
  await palette(page).getByRole('combobox').fill('new task');
  await palette(page).getByRole('option', { name: 'New task' }).click();

  const create = page.getByRole('dialog', { name: 'New task' });
  await expect(create).toBeVisible();
  await expect(palette(page)).toBeHidden();
  await create.getByLabel('Title').fill('From the palette');
  await expect(create.getByLabel('Title')).toHaveValue('From the palette');
});

test('an empty palette shows recent tasks and actions', async ({ page }) => {
  await signUpWithProject(page, 'search-empty');
  await createTaskWithDescription(page, 'Recently made', 'x');

  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page).getByRole('option', { name: /Recently made/ })).toBeVisible();
  await expect(palette(page).getByRole('option', { name: 'My To-do' })).toBeVisible();
});
