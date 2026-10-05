import { expect, test, type Page } from '@playwright/test';
import { createTask } from './tasks';

async function signUpWithTask(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Attachment Tester');
  await page.getByLabel('Email', { exact: true }).fill(`attach-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Attach ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await createTask(page, 'Needs files');
}

test('attach a file, see it after reload, open it, delete it', async ({ page }) => {
  await signUpWithTask(page);
  await page.getByRole('button', { name: 'Needs files', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Task details' });

  await details.getByRole('button', { name: 'Attach files' }).click();
  const upload = page.getByRole('dialog', { name: 'Upload files' });
  await upload.getByLabel('Choose files to attach').setInputFiles({
    name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello attachments'),
  });
  await expect(upload.getByText('Completed')).toBeVisible();
  await upload.getByRole('button', { name: 'Close' }).click();

  await page.reload();
  const card = page.getByRole('link', { name: 'notes.txt', exact: true });
  await expect(card).toBeVisible();
  // The upload day reads relative; the exact time sits in the tooltip.
  await expect(page.getByRole('listitem').filter({ has: card }).locator('time')).toHaveText('Today');
  // Activity opens on Comments; the attach/remove sentences are history.
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('attached “notes.txt”')).toBeVisible();

  // The download link redirects to the bucket with the file as an attachment.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download notes.txt' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('notes.txt');

  await page.getByRole('button', { name: 'Delete notes.txt' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card).toBeHidden();
  await expect(page.getByText('removed attachment “notes.txt”')).toBeVisible();
});

test('a file over 25 MB fails without uploading', async ({ page }) => {
  await signUpWithTask(page);
  await page.getByRole('button', { name: 'Needs files', exact: true }).click();
  await page.getByRole('button', { name: 'Attach files' }).click();
  const upload = page.getByRole('dialog', { name: 'Upload files' });

  await upload.getByLabel('Choose files to attach').setInputFiles({
    name: 'huge.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(25 * 1024 * 1024 + 1),
  });

  await expect(upload.getByText('Files can be up to 25 MB.')).toBeVisible();
  await expect(upload.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
});
