import { expect, test, type Page } from '@playwright/test';
import { createTask } from './tasks';

/** Mirrors the helper in board.spec.ts: a fresh account, workspace, project, task. */
async function signUpWithTask(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Comment Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Comments ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await createTask(page, 'Talk about me');
  await expect(page.getByText('Talk about me')).toBeVisible();
}

test('a comment survives a reload and priority changes show in the feed', async ({ page }) => {
  await signUpWithTask(page, 'comments');

  // The project opens on the board; the card's button is named by its title.
  await page.getByRole('button', { name: 'Talk about me', exact: true }).click();
  await expect(page).toHaveURL(/\?task=/);

  // The feed opens on Comments; the creation entry is in History.
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('created this task')).toBeVisible();

  await page.getByRole('tab', { name: 'Comments' }).click();
  await page.getByLabel('Comment').fill('First thoughts');
  await page.getByRole('button', { name: 'Comment' }).click();

  // Scoped to the feed, as in the Markdown test below: the composer still shows the
  // draft until the post lands, and reloading before then would cancel it.
  const posted = page.getByRole('listitem').getByText('First thoughts');
  await expect(posted).toBeVisible();
  await page.reload();
  await expect(posted).toBeVisible();

  // The priority control is a Radix Select: its trigger picks up the
  // "Priority" label via the matching id/htmlFor, and its options render
  // capitalized labels ("High"), not the raw stored value ("high") that the
  // activity sentence below uses.
  await page.getByLabel('Priority').click();
  await page.getByRole('option', { name: 'High' }).click();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('changed priority from none to high')).toBeVisible();
});

test('a comment is written with the editor and rendered as Markdown', async ({ page }) => {
  await signUpWithTask(page, 'markdown');
  await page.getByRole('button', { name: 'Talk about me', exact: true }).click();

  // Typed key by key so the editor's **bold** input rule fires, as it does for a person.
  await page.getByLabel('Comment').pressSequentially('Ship **today**');
  await page.getByRole('button', { name: 'Comment' }).click();

  // Scoped to the feed: the composer shows its own bold "today" until the post lands, and
  // reloading before then would cancel it.
  const posted = page.getByRole('listitem').locator('strong', { hasText: 'today' });
  await expect(posted).toBeVisible();
  await page.reload();
  await expect(posted).toBeVisible();
});
