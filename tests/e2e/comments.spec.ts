import { expect, test, type Page } from '@playwright/test';

/** Mirrors the helper in board.spec.ts: a fresh account, workspace, project, task. */
async function signUpWithTask(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Comment Tester');
  await page.getByLabel('Email').fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Workspace name').fill(`Comments ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByPlaceholder('Add a task…').fill('Talk about me');
  await page.getByPlaceholder('Add a task…').press('Enter');
  await expect(page.getByText('Talk about me')).toBeVisible();
}

test('a comment survives a reload and priority changes show in the feed', async ({ page }) => {
  await signUpWithTask(page, 'comments');

  // exact: true, because the row also carries a checkbox button whose
  // accessible name ("Mark \"Talk about me\" as done") contains the title —
  // see the comment in board.spec.ts about the two buttons per row.
  await page.getByRole('button', { name: 'Talk about me', exact: true }).click();
  await expect(page).toHaveURL(/\?task=/);

  // The feed opens with the creation entry already in it.
  await expect(page.getByText('created this task')).toBeVisible();

  await page.getByLabel('Comment').fill('First thoughts');
  await page.getByRole('button', { name: 'Comment' }).click();
  await expect(page.getByText('First thoughts')).toBeVisible();

  await page.reload();
  await expect(page.getByText('First thoughts')).toBeVisible();

  // The priority control is a Radix Select: its trigger picks up the
  // "Priority" label via the matching id/htmlFor, and its options render
  // capitalized labels ("High"), not the raw stored value ("high") that the
  // activity sentence below uses.
  await page.getByLabel('Priority').click();
  await page.getByRole('option', { name: 'High' }).click();
  await expect(page.getByText('changed priority from none to high')).toBeVisible();
});
