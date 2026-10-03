import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeTask, createTask } from './tasks';

/** Sets the open task's due date to today and waits for the save. */
async function dueToday(page: Page) {
  const details = page.getByRole('dialog', { name: 'Task details' });
  await details.getByLabel('Due date').click();
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await saved;
  // An Escape sent while the popover is still closing would go to it, not the dialog.
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeHidden();
}

/** A day cell, found by the full date its screen-reader text names ('Sunday, October 4, 2026'). */
function dayCell(page: Page, day: string): Locator {
  const [y, m, d] = day.split('-').map(Number);
  const name = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
  return page.getByRole('cell', { name });
}

async function signUpWithProject(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Cal Tester');
  await page.getByLabel('Email', { exact: true }).fill(`cal-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByLabel('Workspace name').fill(`Cal ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('Launch');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Launch' })).toBeVisible();
  return page.url();
}

/**
 * Presses on the chip, clears dnd-kit's 8px threshold, then glides to the lower
 * part of the target cell (below any chips) in steps and releases.
 */
async function drag(page: Page, chip: Locator, cell: Locator) {
  const from = (await chip.boundingBox())!;
  const to = (await cell.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 8, { steps: 10 });
  await page.mouse.up();
}

/** Today in Asia/Yerevan (the workspace default), as the app sees it. */
function yerevanToday(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(now);
}

test('a task shows on its day and can be dragged to another day', async ({ page }) => {
  const projectUrl = await signUpWithProject(page);
  await createTask(page, 'Write launch post');

  // Give it a due date of today through the task dialog.
  await page.getByText('Write launch post').click();
  await dueToday(page);
  await closeTask(page);

  await page.goto(`${projectUrl}/calendar`);
  const today = yerevanToday();
  const target = today.slice(0, 7) === yerevanToday(1).slice(0, 7) ? yerevanToday(1) : yerevanToday(-1);
  const chip = dayCell(page, today).getByRole('button', { name: 'Write launch post' });
  await expect(chip).toBeVisible();

  // Dropping on the same day saves nothing, and a drag is never a click.
  let posts = 0;
  page.on('request', (r) => { if (r.method() === 'POST') posts += 1; });
  await drag(page, chip, dayCell(page, today));
  await page.waitForTimeout(300);
  expect(posts).toBe(0);
  await expect(page).not.toHaveURL(/[?&]task=/);
  await expect(chip).toBeVisible();

  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/calendar'));
  await drag(page, chip, dayCell(page, target));
  await saved;
  await expect(page).not.toHaveURL(/[?&]task=/);
  await page.reload();
  await expect(dayCell(page, target).getByRole('button', { name: 'Write launch post' })).toBeVisible();
  await expect(dayCell(page, today).getByRole('button', { name: 'Write launch post' })).toHaveCount(0);
});

test('My calendar shows only tasks assigned to me', async ({ page }) => {
  const projectUrl = await signUpWithProject(page);
  const workspaceUrl = projectUrl.replace(/\/projects\/.*/, '');
  await createTask(page, 'Mine');
  await createTask(page, 'Nobody’s');

  for (const [title, assign] of [['Mine', true], ['Nobody’s', false]] as const) {
    await page.getByText(title, { exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Task details' });
    await dueToday(page);
    if (assign) {
      await details.getByLabel('Assignee').click();
      const saved = page.waitForResponse((r) => r.request().method() === 'POST');
      await page.getByRole('option', { name: /Cal Tester/ }).click();
      await saved;
      await expect(page.getByRole('option', { name: /Cal Tester/ })).toBeHidden();
    }
    await closeTask(page);
  }

  await page.goto(`${workspaceUrl}/calendar`);
  await expect(page.getByRole('heading', { name: 'My calendar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mine', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nobody’s' })).toHaveCount(0);
});
