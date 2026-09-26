import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Drag edge cases and the column manager. board.spec.ts covers the happy paths and stays
 * frozen; these follow its helpers and sign-up flow.
 */
async function signUpWithProject(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Board Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Board ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByPlaceholder('Add a task…').fill('Drag me');
  await page.getByPlaceholder('Add a task…').press('Enter');
  await expect(page.getByText('Drag me')).toBeVisible();
}

async function openBoard(page: Page) {
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page).toHaveURL(/\/board$/);
}

const column = (page: Page, name: string) => page.getByRole('region', { name });
const card = (page: Page, columnName: string, title: string) =>
  column(page, columnName).getByRole('button', { name: title, exact: true });

/** Counts the board's Server Action posts, which is how a move is saved. */
function countMoves(page: Page) {
  const posts = { count: 0 };
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/board')) posts.count += 1;
  });
  return posts;
}

/** Lets any save that a drop might have started get as far as the network. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
}

/**
 * Presses on the card and moves far enough to clear the 8px activation threshold, in
 * steps: dnd-kit tracks the drag from intermediate pointermove events.
 */
async function lift(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y, { steps: 5 });
  return { x, y };
}

async function addToColumn(page: Page, columnName: string, title: string) {
  const input = page.getByPlaceholder(`Add to ${columnName}…`);
  await input.fill(title);
  await input.press('Enter');
  await expect(card(page, columnName, title)).toBeVisible();
}

test('Escape mid-drag puts a previewed card back and saves nothing', async ({ page }) => {
  await signUpWithProject(page, 'drag-escape');
  await openBoard(page);
  const moves = countMoves(page);

  const from = await lift(page, card(page, 'Todo', 'Drag me'));
  const to = (await column(page, 'In Progress').boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, from.y, { steps: 15 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 10 });

  // The live preview has moved the card across.
  await expect(card(page, 'In Progress', 'Drag me')).toBeAttached();

  await page.keyboard.press('Escape');
  await page.mouse.up();

  await expect(card(page, 'Todo', 'Drag me')).toBeVisible();
  await settle(page);
  expect(moves.count).toBe(0);

  await page.reload();
  await expect(card(page, 'Todo', 'Drag me')).toBeVisible();
});

test('a release outside every column discards the drag', async ({ page }) => {
  await signUpWithProject(page, 'drag-outside');
  await openBoard(page);
  const moves = countMoves(page);

  const from = await lift(page, card(page, 'Todo', 'Drag me'));
  const to = (await column(page, 'In Progress').boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, from.y, { steps: 15 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 10 });
  await expect(card(page, 'In Progress', 'Drag me')).toBeAttached();

  // Up into the page header, just above the columns: the pointer is outside every column
  // while the dragged card's rect still overlaps one, which must not count as a drop.
  const header = (await page.locator('header').first().boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, header.y + header.height - 4, { steps: 10 });
  await page.mouse.up();

  await expect(card(page, 'Todo', 'Drag me')).toBeVisible();
  await settle(page);
  expect(moves.count).toBe(0);

  await page.reload();
  await expect(card(page, 'Todo', 'Drag me')).toBeVisible();
});

test('a card dropped where it started saves nothing and does not open', async ({ page }) => {
  await signUpWithProject(page, 'drag-in-place');
  await openBoard(page);
  const moves = countMoves(page);

  const from = await lift(page, card(page, 'Todo', 'Drag me'));
  await page.mouse.move(from.x, from.y, { steps: 5 });
  await page.mouse.up();

  await expect(card(page, 'Todo', 'Drag me')).toBeVisible();
  await settle(page);
  expect(moves.count).toBe(0);
  await expect(page).not.toHaveURL(/\?task=/);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('Enter on a focused card opens the task rather than lifting it', async ({ page }) => {
  await signUpWithProject(page, 'enter-opens');
  await openBoard(page);

  await card(page, 'Todo', 'Drag me').focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\?task=/);
  await expect(page.getByLabel('Title')).toHaveValue('Drag me');
});

test('a card dropped below the last card of a column lands last', async ({ page }) => {
  await signUpWithProject(page, 'drag-below');
  await openBoard(page);

  // Positions are keyed per column, so these cards interleave with the movers in the
  // board's flat list: "Drag me" (Todo) sorts before Second, "Mover" (Done, behind two
  // cards) after it. Mapping "below the last card" to that card made the result depend on
  // which side of it the mover sat — one of the two drags below landed in the middle.
  await addToColumn(page, 'In Progress', 'First');
  await addToColumn(page, 'In Progress', 'Second');
  await addToColumn(page, 'Done', 'Done one');
  await addToColumn(page, 'Done', 'Done two');
  await addToColumn(page, 'Done', 'Mover');

  const inProgress = column(page, 'In Progress');

  async function dropBelowLast(source: Locator) {
    const from = await lift(page, source);
    const to = (await inProgress.boundingBox())!;
    await page.mouse.move(to.x + to.width / 2, from.y, { steps: 15 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 120, { steps: 10 });

    const written = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/board'),
    );
    await page.mouse.up();
    return written;
  }

  let written = await dropBelowLast(card(page, 'Todo', 'Drag me'));
  await expect(inProgress.getByRole('listitem')).toHaveText([/First/, /Second/, /Drag me/]);
  await written;

  written = await dropBelowLast(card(page, 'Done', 'Mover'));
  await expect(inProgress.getByRole('listitem')).toHaveText([/First/, /Second/, /Drag me/, /Mover/]);
  await written;

  // Within its own column, too.
  written = await dropBelowLast(card(page, 'In Progress', 'First'));
  await expect(inProgress.getByRole('listitem')).toHaveText([/Second/, /Drag me/, /Mover/, /First/]);
  await written;

  await page.reload();
  await expect(column(page, 'In Progress').getByRole('listitem'))
    .toHaveText([/Second/, /Drag me/, /Mover/, /First/]);
});

test('columns can be renamed, added, marked done and deleted with their tasks moved', async ({ page }) => {
  await signUpWithProject(page, 'columns');
  await openBoard(page);

  await page.getByRole('button', { name: 'Columns' }).click();
  const dialog = page.getByRole('dialog');

  // Rename, committed with Enter.
  await dialog.getByLabel('Todo name').fill('Backlog');
  await dialog.getByLabel('Todo name').press('Enter');
  await expect(dialog.getByLabel('Backlog name')).toHaveValue('Backlog');

  // Add.
  await dialog.getByLabel('New column name').fill('Review');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByLabel('Review name')).toHaveValue('Review');

  // Mark as completing tasks.
  const completes = dialog.getByRole('switch', { name: 'Review completes tasks' });
  await expect(completes).not.toBeChecked();
  await completes.click();
  await expect(dialog.getByRole('switch', { name: 'Review completes tasks' })).toBeChecked();

  // Delete a column that holds a task, moving the task to Review.
  await dialog.getByRole('button', { name: 'Delete Backlog' }).click();
  await dialog.getByRole('combobox', { name: 'Move tasks to' }).click();
  await page.getByRole('option', { name: 'Review' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByLabel('Backlog name')).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(column(page, 'Backlog')).toHaveCount(0);
  await expect(card(page, 'Review', 'Drag me')).toBeVisible();

  await page.reload();
  await expect(card(page, 'Review', 'Drag me')).toBeVisible();
});
