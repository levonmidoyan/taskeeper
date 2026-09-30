import { expect, test } from '@playwright/test';
import { Client } from 'pg';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function signUp(page: import('@playwright/test').Page, name: string, email: string) {
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
}

/** The link lives only in the email, which the browser cannot reach. */
async function invitationIdFor(email: string): Promise<string> {
  const client = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM invitation WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [email],
    );
    return rows[0].id;
  } finally {
    await client.end();
  }
}

test('an invitee joins only by pressing Accept, as a member who cannot recolor projects', async ({ page, browser }) => {
  const slugSeed = Math.random().toString(36).slice(2, 8);
  const workspace = `Invite Co ${slugSeed}`;
  const guestEmail = uniqueEmail('guest');

  await page.goto('/auth/sign-up');
  await signUp(page, 'Owner', uniqueEmail('owner'));
  await expect(page).toHaveURL(/\/new-workspace/);
  await page.getByLabel('Workspace name').fill(workspace);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/invite-co-${slugSeed}`));
  const slug = new URL(page.url()).pathname.split('/')[1];

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('button', { name: 'Change color of Website' })).toBeVisible();

  await page.goto(`/${slug}/settings/members`);
  await page.getByLabel('Invite by email').fill(guestEmail);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(`Invitation sent to ${guestEmail}.`)).toBeVisible();
  const invitationId = await invitationIdFor(guestEmail);

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/invite/${invitationId}`);
  await expect(guest).toHaveURL(/\/auth\/sign-up/);
  await signUp(guest, 'Guest', guestEmail);

  await expect(guest).toHaveURL(new RegExp(`/invite/${invitationId}`));
  await expect(guest.getByRole('heading', { name: `Join ${workspace}` })).toBeVisible();
  // Opening the page did not join: the workspace is still closed to the guest.
  const before = await guest.request.get(`/${slug}`);
  expect(before.status()).toBe(404);

  await guest.getByRole('button', { name: 'Accept' }).click();
  await expect(guest).toHaveURL(new RegExp(`/${slug}$`));
  await expect(guest.getByRole('link', { name: 'Website' }).first()).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Change color of Website' })).toHaveCount(0);
});
