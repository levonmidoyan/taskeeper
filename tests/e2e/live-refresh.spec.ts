import { expect, test, type Browser, type Page } from '@playwright/test';
import { Client } from 'pg';
import { createTask } from './tasks';

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function signUp(page: Page, name: string, email: string) {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await expect(page).toHaveURL(/\/new-workspace/);
}

/** Straight into the workspace; invite.spec.ts covers the real invitation flow. */
async function addMember(slug: string, email: string) {
  const client = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO member (id, organization_id, user_id, role)
       SELECT $3, o.id, u.id, 'member' FROM organization o, "user" u WHERE o.slug = $1 AND u.email = $2`,
      [slug, email, `m-${stamp()}`],
    );
  } finally {
    await client.end();
  }
}

/** Ada (owner, `page`) and Bob (member, own browser context) on the same project. */
async function twoMembers(page: Page, browser: Browser) {
  const s = stamp();
  await signUp(page, 'Ada', `ada-${s}@example.com`);
  await page.getByLabel('Workspace name').fill(`Live ${s}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\//);
  const projectUrl = page.url();
  const slug = new URL(projectUrl).pathname.split('/')[1];

  const bobEmail = `bob-${s}@example.com`;
  const bob = await (await browser.newContext()).newPage();
  await signUp(bob, 'Bob', bobEmail);
  await addMember(slug, bobEmail);
  await bob.goto(projectUrl);
  return { bob };
}

/** What the browser does when Ada comes back to the tab; skips the 30 s wait. */
const refocus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

test("a teammate's new task shows up without a reload", async ({ page, browser }) => {
  const { bob } = await twoMembers(page, browser);

  await createTask(bob, 'From Bob');
  await expect(bob.getByText('From Bob')).toBeVisible();
  await expect(page.getByText('From Bob')).toHaveCount(0);

  await refocus(page);
  await expect(page.getByText('From Bob')).toBeVisible();
});

test('a refresh waits while I type, then lands with my draft intact', async ({ page, browser }) => {
  const { bob } = await twoMembers(page, browser);
  await createTask(page, 'Shared');
  // The project opens on the board; the card's button is named by its title.
  await page.getByRole('button', { name: 'Shared', exact: true }).click();
  await expect(page).toHaveURL(/[?&]task=/);
  await page.getByRole('tab', { name: 'Comments' }).click();
  await page.getByLabel('Comment').pressSequentially('Half a thought');

  await createTask(bob, 'From Bob');
  await refocus(page);
  // The poll has answered, but the composer still has focus.
  await page.waitForTimeout(1500);
  await expect(page.getByText('From Bob')).toHaveCount(0);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.getByText('From Bob')).toHaveCount(1);
  await expect(page.getByLabel('Comment')).toContainText('Half a thought');
});
