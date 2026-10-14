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

/** Bob renames one of Ada's tasks from the board and waits for his save to land. */
async function bobRenames(bob: Page, from: string, to: string) {
  await bob.reload();
  await bob.getByRole('button', { name: from, exact: true }).click();
  const dialog = bob.getByRole('dialog', { name: 'Task details' });
  await dialog.getByLabel('Title').fill(to);
  await dialog.getByLabel('Title').blur();
  await bob.keyboard.press('Escape');
  await expect(bob.getByRole('button', { name: to, exact: true })).toBeVisible();
}

test('after I mark all read, the next change still toasts on the background poll', async ({ page, browser }) => {
  // A fake clock, so the 30 s poll can be fast-forwarded without a focus event.
  await page.clock.install();
  const { bob } = await twoMembers(page, browser);
  await createTask(page, 'Fix login');
  await createTask(page, 'Write docs');

  await bobRenames(bob, 'Fix login', 'Fix login on Safari');
  await refocus(page);
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  // Mark all read stays on the page, so nothing re-renders the shell's count.
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();

  await bobRenames(bob, 'Write docs', 'Write the docs');
  await page.clock.fastForward(31_000);
  const toasts = page.getByRole('region', { name: /^Notifications alt/ });
  await expect(toasts.getByText('Write the docs')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
});

test('a browser clock running ahead does not swallow toasts', async ({ page, browser }) => {
  await page.clock.install({ time: Date.now() + 5 * 60_000 });
  const { bob } = await twoMembers(page, browser);
  await createTask(page, 'Fix login');

  await bobRenames(bob, 'Fix login', 'Fix login on Safari');
  await refocus(page);
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  await expect(page.getByText('Bob changed title')).toBeVisible();
});

test('clearing removes items from the bell, one or all, and they stay gone', async ({ page, browser }) => {
  const { bob } = await twoMembers(page, browser);
  await createTask(page, 'Fix login');
  await createTask(page, 'Write docs');
  await bobRenames(bob, 'Fix login', 'Fix login on Safari');
  await bobRenames(bob, 'Write docs', 'Write the docs');

  await refocus(page);
  await page.getByRole('button', { name: 'Notifications, 2 unread' }).click();
  const list = page.getByRole('list', { name: 'Notifications' });
  await list.getByRole('button', { name: 'Clear notification: Fix login on Safari' }).click();
  await expect(list.getByText('Fix login on Safari')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();

  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(list.getByText('Nothing yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Notifications' }).getByText('Nothing yet.')).toBeVisible();
});

test('the Inbox page picks up a notification that arrives while it is open', async ({ page, browser }) => {
  const { bob } = await twoMembers(page, browser);
  await createTask(page, 'Fix login');
  const slug = new URL(page.url()).pathname.split('/')[1];
  await page.goto(`/${slug}/inbox`);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();

  await bob.reload();
  await bob.getByRole('button', { name: 'Fix login', exact: true }).click();
  const theirs = bob.getByRole('dialog', { name: 'Task details' });
  await theirs.getByLabel('Title').fill('Fix login on Safari');
  await theirs.getByLabel('Title').blur();
  await bob.keyboard.press('Escape');
  await expect(bob.getByRole('button', { name: 'Fix login on Safari', exact: true })).toBeVisible();

  await refocus(page);
  await expect(page.getByRole('main').getByRole('list', { name: 'Notifications' }).getByText('Bob changed title')).toBeVisible();
});
