import { expect, test, type Page } from '@playwright/test';

async function signUp(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Todo Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Todo ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
}

const openList = (page: Page) => page.getByRole('list', { name: 'Open to-dos' });
const openTitles = (page: Page) => openList(page).locator('[data-todo-title]');

/** dnd-kit's live region; the page has one DndContext. */
const announcer = (page: Page) => page.locator('[id^="DndLiveRegion"]');

/**
 * The lift schedules dnd-kit's measuring pass; an arrow key handled before it
 * runs moves nowhere (same as board.spec.ts), so yield two frames per key.
 */
const frames = (page: Page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/**
 * The server action's POST. Waiting on it, not on networkidle, keeps a reload
 * from landing before the save: networkidle resolves at once when the page
 * already reached it once since load.
 */
const saved = (page: Page) =>
  page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/todo'));

test('a to-do can be added, reordered, checked and restored from Completed', async ({ page }) => {
  await signUp(page, 'todo');

  await page.getByRole('link', { name: 'To-do' }).click();
  await expect(page).toHaveURL(/\/todo$/);
  await expect(page.getByRole('heading', { name: 'To-do' })).toBeVisible();

  const add = page.getByPlaceholder('Add a to-do…');
  for (const title of ['Buy milk', 'Call Ada', 'File taxes']) {
    await add.fill(title);
    await add.press('Enter');
    await expect(openTitles(page).filter({ hasText: title })).toBeVisible();
  }
  await expect(add).toBeFocused();
  await expect(openTitles(page)).toHaveText(['Buy milk', 'Call Ada', 'File taxes']);

  // Keyboard drag: Space lifts, arrows move, Space drops.
  await page.getByRole('button', { name: 'Reorder "File taxes"' }).focus();
  await page.keyboard.press('Space');
  await expect(announcer(page)).toContainText('Draggable item');
  await frames(page);
  await page.keyboard.press('ArrowUp');
  await frames(page);
  await page.keyboard.press('ArrowUp');
  await frames(page);
  const moved = saved(page);
  await page.keyboard.press('Space');
  await expect(announcer(page)).toContainText('was dropped');
  await expect(openTitles(page)).toHaveText(['File taxes', 'Buy milk', 'Call Ada']);

  await moved;
  await page.reload();
  await expect(openTitles(page)).toHaveText(['File taxes', 'Buy milk', 'Call Ada']);

  const checked = saved(page);
  await page.getByRole('button', { name: 'Mark "Buy milk" as done' }).click();
  await expect(openTitles(page)).toHaveText(['File taxes', 'Call Ada']);
  // Settled first, so the next wait cannot be satisfied by this save.
  await checked;

  const completed = page.getByRole('button', { name: 'Completed (1)' });
  await expect(completed).toHaveAttribute('aria-expanded', 'false');
  await completed.click();

  const restored = saved(page);
  await page
    .getByRole('list', { name: 'Completed to-dos' })
    .getByRole('button', { name: 'Mark "Buy milk" as not done' })
    .click();
  await expect(openTitles(page)).toHaveText(['File taxes', 'Call Ada', 'Buy milk']);
  await expect(page.getByRole('button', { name: /^Completed/ })).toHaveCount(0);

  await restored;
  await page.reload();
  await expect(openTitles(page)).toHaveText(['File taxes', 'Call Ada', 'Buy milk']);
});

test('deleting a to-do asks for confirmation first', async ({ page }) => {
  await signUp(page, 'todo-delete');

  await page.getByRole('link', { name: 'To-do' }).click();
  const add = page.getByPlaceholder('Add a to-do…');
  for (const title of ['Keep me', 'Drop me']) {
    await add.fill(title);
    await add.press('Enter');
    await expect(openTitles(page).filter({ hasText: title })).toBeVisible();
  }

  const confirm = page.getByRole('alertdialog', { name: 'Delete "Drop me"?' });

  // Cancel leaves it in place.
  await page.getByRole('button', { name: 'More actions for "Drop me"' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(openTitles(page)).toHaveText(['Keep me', 'Drop me']);

  await page.getByRole('button', { name: 'More actions for "Drop me"' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const deleted = saved(page);
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(openTitles(page)).toHaveText(['Keep me']);

  await deleted;
  await page.reload();
  await expect(openTitles(page)).toHaveText(['Keep me']);
});
