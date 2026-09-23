import { expect, test, type Page } from '@playwright/test';

async function signUpWithProject(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Board Tester');
  await page.getByLabel('Email').fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Workspace name').fill(`Board ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByPlaceholder('Add a task…').fill('Drag me');
  await page.getByPlaceholder('Add a task…').press('Enter');
  await expect(page.getByText('Drag me')).toBeVisible();
}

/**
 * Opens the board and returns the card. Both steps matter: without waiting for
 * the URL the locator resolves against the list view, which is still on screen
 * and where the row carries two buttons whose name contains the title — the
 * checkbox and the title itself. Scoping to the column keeps it to the card.
 */
/**
 * A Server Action posts back to the page's own URL. Waiting for that response
 * before reloading keeps the reload from racing the move that is still in
 * flight: the optimistic UI shows the card in its new column immediately, but
 * the row is not written yet.
 */
function moveWritten(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/board'),
  );
}

async function openBoard(page: Page, title: string) {
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page).toHaveURL(/\/board$/);
  return page.getByRole('region', { name: 'Todo' }).getByRole('button', { name: title, exact: true });
}

test('a card dragged with the pointer stays in its new column after reload', async ({ page }) => {
  await signUpWithProject(page, 'drag');

  const card = await openBoard(page, 'Drag me');
  const inProgress = page.getByRole('region', { name: 'In Progress' });

  const from = (await card.boundingBox())!;
  const to = (await inProgress.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Several moves, not one jump: dnd-kit tracks the drag from intermediate
  // pointermove events, and the first few only clear the 8px activation
  // threshold. A single move lands nothing.
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, from.y + from.height / 2, { steps: 15 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 10 });

  const written = moveWritten(page);
  await page.mouse.up();

  await expect(inProgress.getByText('Drag me')).toBeVisible();
  await written;

  await page.reload();
  await expect(
    page.getByRole('region', { name: 'In Progress' }).getByText('Drag me'),
  ).toBeVisible();
});

test('a card can be moved with the keyboard alone', async ({ page }) => {
  await signUpWithProject(page, 'keyboard');

  const card = await openBoard(page, 'Drag me');
  // dnd-kit's own live region, which it updates as the drag progresses. Waiting
  // on it rather than on a timeout keeps each keystroke behind the state change
  // the previous one caused: pressed together, the arrow is handled before the
  // lift has committed and the drop lands back where it started.
  const announcer = page.locator('[id^="DndLiveRegion"]');

  await card.focus();
  await page.keyboard.press('Space');
  await expect(announcer).toContainText('Draggable item');

  // The lift schedules dnd-kit's measuring pass. An arrow key handled before
  // that pass has run sees no measured columns and moves nowhere, so yield two
  // frames rather than pressing into an unmeasured board.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  await page.keyboard.press('ArrowRight');
  await expect(announcer).toContainText('droppable area status:');

  const written = moveWritten(page);
  await page.keyboard.press('Space');
  await expect(announcer).toContainText('was dropped');

  await expect(
    page.getByRole('region', { name: 'In Progress' }).getByText('Drag me'),
  ).toBeVisible();
  await written;

  await page.reload();
  await expect(
    page.getByRole('region', { name: 'In Progress' }).getByText('Drag me'),
  ).toBeVisible();
});

test('a task opened from the board is deep-linkable and closes with back', async ({ page }) => {
  await signUpWithProject(page, 'deeplink');

  const card = await openBoard(page, 'Drag me');
  const boardUrl = page.url();

  await card.click();
  await expect(page).toHaveURL(/\?task=/);
  await expect(page.getByLabel('Title')).toHaveValue('Drag me');

  // Deep-linkable: the same URL loaded cold reopens the panel.
  const deepLink = page.url();
  await page.reload();
  await expect(page.getByLabel('Title')).toHaveValue('Drag me');

  // Back-dismissable: opening the panel pushed an entry, so back returns to the
  // plain board. The reload above replaced rather than pushed, so this walks
  // back to the board the card was clicked from.
  await page.goBack();
  await expect(page).toHaveURL(boardUrl);
  await expect(page.getByLabel('Title')).toBeHidden();

  expect(deepLink).toContain('?task=');
});
