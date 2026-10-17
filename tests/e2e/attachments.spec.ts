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
  // A text file opens the preview modal, so its card is a button.
  const card = page.getByRole('button', { name: 'notes.txt', exact: true });
  await expect(card).toBeVisible();
  // The upload day reads relative; the exact time sits in the tooltip.
  await expect(page.getByRole('listitem').filter({ has: card }).locator('time')).toHaveText('Today');
  // Activity opens on Comments; the attach/remove sentences are history.
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('attached “notes.txt”')).toBeVisible();

  await card.click();
  const preview = page.getByRole('dialog', { name: 'notes.txt' });
  await expect(preview.getByLabel('File contents')).toHaveText('hello attachments');
  await preview.getByRole('button', { name: 'Close' }).click();
  await expect(preview).toBeHidden();

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

test('an image opens in the preview modal', async ({ page }) => {
  await signUpWithTask(page);
  await page.getByRole('button', { name: 'Needs files', exact: true }).click();
  // A 1×1 transparent PNG.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await attach(page, { name: 'dot.png', mimeType: 'image/png', buffer: png });

  await page.getByRole('button', { name: 'dot.png', exact: true }).click();
  const image = page.getByRole('dialog', { name: 'dot.png' }).getByRole('img', { name: 'dot.png' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
});

async function attach(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByRole('button', { name: 'Attach files' }).click();
  const upload = page.getByRole('dialog', { name: 'Upload files' });
  await upload.getByLabel('Choose files to attach').setInputFiles(file);
  await expect(upload.getByText('Completed')).toBeVisible();
  await upload.getByRole('button', { name: 'Close' }).click();
}

test('source code opens in a read-only code view', async ({ page }) => {
  await signUpWithTask(page);
  await page.getByRole('button', { name: 'Needs files', exact: true }).click();
  await attach(page, { name: 'hello.ts', mimeType: 'video/mp2t', buffer: Buffer.from('const greet = (name: string) => `hi ${name}`;\nexport default greet;\n') });

  await page.getByRole('button', { name: 'hello.ts', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'hello.ts' });
  const code = preview.getByLabel('File contents');
  await expect(code).toContainText('export default greet;');
  await expect(preview.locator('.cm-lineNumbers')).toContainText('2');
  // Grammar loads lazily, then keywords get their own colour.
  await expect(preview.locator('.cm-line').first().locator('span').first()).toHaveText('const');

  await code.click();
  await page.keyboard.type('xyz');
  await expect(code).not.toContainText('xyz');
});

test('audio plays in the preview modal', async ({ page }) => {
  await signUpWithTask(page);
  await page.getByRole('button', { name: 'Needs files', exact: true }).click();
  // A 0.1 s mono 8 kHz 8-bit silent WAV.
  const samples = 800;
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples, 40);
  await attach(page, { name: 'memo.wav', mimeType: 'audio/wav', buffer: wav });

  await page.getByRole('button', { name: 'memo.wav', exact: true }).click();
  const audio = page.getByRole('dialog', { name: 'memo.wav' }).locator('audio');
  await expect(audio).toBeVisible();
  // Metadata loaded through the redirect: the duration is known.
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration)).toBeCloseTo(0.1, 2);
});
