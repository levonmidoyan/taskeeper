import { expect, test, type Page } from '@playwright/test';
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

async function signUpWithProject(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Rem Tester');
  await page.getByLabel('Email', { exact: true }).fill(`rem-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByLabel('Workspace name').fill(`Rem ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('Ops');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Ops' })).toBeVisible();
  return page.url();
}

test('preferences: digest switch and reminder hour persist', async ({ page }) => {
  await signUpWithProject(page);
  await page.goto('/settings/preferences');

  await page.getByLabel('Daily digest').click();
  await page.getByLabel('Reminder time').click();
  await page.getByRole('option', { name: '00:00' }).click();
  await page.getByRole('button', { name: 'Save' }).last().click();
  await expect(page.getByText('Reminder settings updated.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Daily digest')).not.toBeChecked();
  await expect(page.getByLabel('Reminder time')).toHaveText('00:00');
});

test('a reminder set in the dialog reaches the bell after the cron runs', async ({ page }) => {
  await signUpWithProject(page);

  // Hour 00:00 makes "on the day" due as soon as the day starts.
  await page.goto('/settings/preferences');
  await page.getByLabel('Reminder time').click();
  await page.getByRole('option', { name: '00:00' }).click();
  await page.getByRole('button', { name: 'Save' }).last().click();
  await expect(page.getByText('Reminder settings updated.')).toBeVisible();
  await page.goBack();

  await createTask(page, 'Rotate keys');
  await page.getByText('Rotate keys').click();
  const details = page.getByRole('dialog', { name: 'Task details' });
  await expect(details.getByLabel('Remind me')).toBeDisabled();

  await dueToday(page);
  await details.getByLabel('Remind me').click();
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('menuitemcheckbox', { name: 'On the day' }).click();
  await saved;
  // The first Escape closes the menu, closeTask's closes the dialog.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitemcheckbox', { name: 'On the day' })).toBeHidden();
  await closeTask(page);

  const run = await page.request.get('/api/cron/reminders', {
    headers: { authorization: 'Bearer e2e-cron-secret' },
  });
  expect(run.ok()).toBe(true);

  await page.reload();
  const bell = page.getByRole('button', { name: /Notifications, \d+ unread/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const item = page.getByRole('link', { name: /Rotate keys/ });
  await expect(item).toContainText('Due today');
  await item.click();
  await expect(page).toHaveURL(/\/tasks\//);
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});

test('the cron route refuses a caller without the secret', async ({ page }) => {
  const res = await page.request.get('/api/cron/reminders');
  expect(res.status()).toBe(401);
});
