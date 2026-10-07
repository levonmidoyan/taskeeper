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
  await page.getByLabel('Workspace name').fill(`Notify ${s}`);
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

test("a teammate's edit to my task shows in my bell and as a toast", async ({ page, browser }) => {
  const { bob } = await twoMembers(page, browser);
  await createTask(page, 'Fix login');

  await bob.reload();
  await bob.getByRole('button', { name: 'Fix login', exact: true }).click();
  const theirs = bob.getByRole('dialog', { name: 'Task details' });
  await theirs.getByLabel('Title').fill('Fix login on Safari');
  await theirs.getByLabel('Title').blur();
  await bob.keyboard.press('Escape');
  await expect(bob.getByRole('button', { name: 'Fix login on Safari', exact: true })).toBeVisible();

  await refocus(page);
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  await expect(page.getByText('Bob changed title')).toBeVisible();
  // Scoped to this toast: Ada's own "Task created" toast has an Open button too.
  await page.getByRole('listitem').filter({ hasText: 'Bob changed title' }).getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/tasks\//);
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});

test('renaming a project tells the other members', async ({ page, browser }) => {
  const { bob } = await twoMembers(page, browser);
  await page.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('dialog').getByLabel('Project name').fill('Marketing site');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Marketing site' })).toBeVisible();

  await refocus(bob);
  await expect(bob.getByText('Ada renamed to Marketing site')).toBeVisible();
});
