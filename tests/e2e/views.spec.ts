import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { createTask } from './tasks';

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function signUp(page: Page, name: string, email: string) {
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
}

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

/** Owner with a workspace and a project "Launch" holding two tasks; returns the project URL and slug. */
async function ownerWithProject(page: Page) {
  const s = stamp();
  await page.goto('/auth/sign-up');
  await signUp(page, 'Owner', `views-owner-${s}@example.com`);
  await page.getByLabel('Workspace name').fill(`Views ${s}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Launch');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Launch' })).toBeVisible();
  await createTask(page, 'Alpha release');
  await createTask(page, 'Beta docs');
  const url = new URL(page.url());
  return { projectUrl: url.pathname, slug: url.pathname.split('/')[1] };
}

/** A task title in a project List row (a button that opens the task). */
const listTitle = (page: Page, title: string) => page.getByRole('button', { name: title, exact: true });

async function filterByText(page: Page, text: string) {
  await page.getByLabel('Filter by text').fill(text);
  await expect(page).toHaveURL(new RegExp(`[?&]q=${text}`));
}

test('filter the list, save a shared view; a teammate opens it, cannot edit, can duplicate', async ({ page, browser }) => {
  const { projectUrl, slug } = await ownerWithProject(page);
  await page.goto(`${projectUrl}/list`);
  await expect(listTitle(page, 'Beta docs')).toBeVisible();

  await filterByText(page, 'alpha');
  await expect(listTitle(page, 'Alpha release')).toBeVisible();
  await expect(listTitle(page, 'Beta docs')).toHaveCount(0);

  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save view' });
  await dialog.getByLabel('View name').fill('Alpha only');
  await dialog.getByRole('switch', { name: 'Share with the workspace' }).click();
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await expect(page).toHaveURL(/[?&]view=/);
  const tab = page.getByRole('tab', { name: 'Alpha only' });
  await expect(tab).toHaveAttribute('aria-selected', 'true');

  // Modify, then Reset.
  await page.getByLabel('Filter by text').fill('');
  await expect(page.getByText('Modified')).toBeVisible();
  await expect(listTitle(page, 'Beta docs')).toBeVisible();
  await page.getByRole('link', { name: 'Reset' }).click();
  await expect(page.getByText('Modified')).toHaveCount(0);
  await expect(listTitle(page, 'Beta docs')).toHaveCount(0);

  // A bare ?view= link loads the stored filter.
  const viewId = new URL(page.url()).searchParams.get('view')!;
  await page.goto(`${projectUrl}/list?view=${viewId}`);
  await expect(page).toHaveURL(/[?&]q=alpha/);

  // Invite a member.
  const guestEmail = `views-guest-${stamp()}@example.com`;
  await page.goto(`/${slug}/settings/members`);
  await page.getByLabel('Invite by email').fill(guestEmail);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(`Invitation sent to ${guestEmail}.`)).toBeVisible();
  const invitationId = await invitationIdFor(guestEmail);
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/invite/${invitationId}`);
  await signUp(guest, 'Guest', guestEmail);
  await guest.getByRole('button', { name: 'Accept' }).click();
  await expect(guest).toHaveURL(new RegExp(`/${slug}$`));

  await guest.goto(`${projectUrl}/list`);
  await guest.getByRole('tab', { name: 'Alpha only' }).click();
  await expect(listTitle(guest, 'Beta docs')).toHaveCount(0);
  await guest.getByRole('button', { name: 'Actions for view Alpha only' }).click();
  await expect(guest.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0);
  await expect(guest.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await guest.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(guest.getByRole('tab', { name: /Alpha only \(copy\)/ })).toHaveAttribute('aria-selected', 'true');

  // The copy is private: the owner doesn't see it.
  await page.reload();
  await expect(page.getByRole('tab', { name: /Alpha only \(copy\)/ })).toHaveCount(0);
});

test('a workspace view saved from All tasks shows up in the rail', async ({ page }) => {
  const { slug } = await ownerWithProject(page);
  await page.getByRole('link', { name: 'All tasks' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/tasks`));
  await expect(page.getByRole('link', { name: 'Beta docs' })).toBeVisible();

  await filterByText(page, 'beta');
  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save view' });
  await dialog.getByLabel('View name').fill('Docs work');
  await dialog.getByRole('button', { name: 'Save view' }).click();

  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await expect(nav.getByRole('link', { name: /Docs work/ })).toBeVisible();
  await page.goto(`/${slug}`);
  await nav.getByRole('link', { name: /Docs work/ }).click();
  await expect(page.getByRole('heading', { name: 'Docs work' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alpha release' })).toHaveCount(0);
});

test('board status filter keeps empty columns; an unknown view says so', async ({ page }) => {
  const { projectUrl } = await ownerWithProject(page);
  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Done' }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/[?&]status=/);
  await expect(page.getByText('Alpha release')).toHaveCount(0);
  // Columns are still there to drop into.
  await expect(page.getByRole('heading', { name: 'Todo' })).toBeVisible();

  await page.goto(`${projectUrl}/list?view=does-not-exist`);
  await expect(page.getByText('View not found')).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]view=/);
});
