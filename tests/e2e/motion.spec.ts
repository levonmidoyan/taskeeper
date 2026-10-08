import { type Browser, expect, test, type Locator, type Page } from '@playwright/test';
import { Client } from 'pg';
import { createTask } from './tasks';

/** Motion (docs/superpowers/specs/2026-10-08-motion-design.md). */
async function signUpWithProject(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Motion Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByLabel('Workspace name').fill(`Motion ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\//);
}

/**
 * Collects the pseudo-element of every running animation each frame, so a test
 * can ask afterwards which view transitions ran (they last ~300 ms).
 */
async function recordViewTransitions(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __vt: Set<string> };
    w.__vt = new Set();
    const tick = () => {
      for (const a of document.getAnimations()) {
        const pseudo = (a.effect as KeyframeEffect | null)?.pseudoElement;
        if (pseudo?.startsWith('::view-transition')) w.__vt.add(pseudo);
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

const seenViewTransitions = (page: Page) =>
  page.evaluate(() => [...(window as unknown as { __vt: Set<string> }).__vt]);

/** No view transition is running any more. */
const viewTransitionsDone = (page: Page) =>
  page.waitForFunction(() => !document.getAnimations().some(
    (a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition'),
  ));

const column = (page: Page, name: string) => page.getByRole('region', { name });
const card = (page: Page, columnName: string, title: string) =>
  column(page, columnName).getByRole('button', { name: title, exact: true });

/** Press, then move past the 8px activation threshold in steps (board-drag.spec.ts). */
async function lift(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20, { steps: 5 });
}

async function dropOn(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20, { steps: 10 });
  await page.mouse.up();
}

test.describe('drag', () => {
  test('a dragged card lifts, leaves a slot, and nothing floats after the drop', async ({ page }) => {
    await signUpWithProject(page, 'motion-drag');
    await createTask(page, 'Lift me');

    await lift(page, card(page, 'Todo', 'Lift me'));
    const overlay = page.locator('.animate-kanban-lift');
    await expect(overlay).toBeVisible();
    await expect(page.locator('[data-card-body]').filter({ hasText: 'Lift me' }).first()).toHaveCSS('opacity', '0');

    await dropOn(page, column(page, 'In Progress'));
    await expect(overlay).toHaveCount(0);
    await expect(card(page, 'In Progress', 'Lift me')).toBeVisible();
    await expect(card(page, 'In Progress', 'Lift me').locator('[data-card-body]')).toHaveCSS('opacity', '1');
  });
});

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the lift does not tilt', async ({ page }) => {
    await signUpWithProject(page, 'motion-reduced');
    await createTask(page, 'Still');
    await lift(page, card(page, 'Todo', 'Still'));
    await expect(page.locator('.animate-kanban-lift')).toHaveCSS('animation-name', 'none');
    await page.mouse.up();
  });
});

test.describe('task modal', () => {
  test('a task opened from the board grows out of its card and shrinks back', async ({ page }) => {
    await signUpWithProject(page, 'motion-modal');
    await createTask(page, 'Morph me');
    await recordViewTransitions(page);

    await card(page, 'Todo', 'Morph me').click();
    const details = page.getByRole('dialog', { name: 'Task details' });
    await expect(details).toBeVisible();
    await expect(page).toHaveURL(/[?&]task=/);
    // Clickable straight away: the root swaps instantly, nothing covers the dialog.
    await details.getByRole('tab', { name: 'Comments' }).click();
    await viewTransitionsDone(page);
    expect((await seenViewTransitions(page)).some((p) => p.startsWith('::view-transition-group(task-'))).toBe(true);

    await recordViewTransitions(page);
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();
    await expect(card(page, 'Todo', 'Morph me')).toBeVisible();
    await viewTransitionsDone(page);
    expect((await seenViewTransitions(page)).some((p) => p.startsWith('::view-transition-group(task-'))).toBe(true);
  });

  test('a task opened from the list morphs too', async ({ page }) => {
    await signUpWithProject(page, 'motion-list');
    await createTask(page, 'Row task');
    await page.getByRole('tab', { name: 'List' }).click();
    await recordViewTransitions(page);
    await page.getByRole('button', { name: 'Row task', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Task details' })).toBeVisible();
    await viewTransitionsDone(page);
    expect((await seenViewTransitions(page)).some((p) => p.startsWith('::view-transition-group(task-'))).toBe(true);
  });
});

/** Bob joins Ada's workspace directly (live-refresh.spec.ts does the same). */
async function addBob(page: Page, browser: Browser) {
  const slug = new URL(page.url()).pathname.split('/')[1];
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `bob-${stamp}@example.com`;
  const bob = await (await browser.newContext()).newPage();
  await bob.goto('/auth/sign-up');
  await bob.getByLabel('Name', { exact: true }).fill('Bob');
  await bob.getByLabel('Email', { exact: true }).fill(email);
  await bob.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await bob.getByRole('button', { name: 'Sign Up' }).click();
  await expect(bob).toHaveURL(/\/new-workspace/);
  const client = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO member (id, organization_id, user_id, role)
       SELECT $3, o.id, u.id, 'member' FROM organization o, "user" u WHERE o.slug = $1 AND u.email = $2`,
      [slug, email, `m-${stamp}`],
    );
  } finally {
    await client.end();
  }
  await bob.goto(page.url());
  return bob;
}

/** What the browser does when Ada comes back to the tab; skips the 30 s poll. */
const refocus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

test.describe('teammate changes', () => {
  test("a teammate's new card grows in on live refresh", async ({ page, browser }) => {
    await signUpWithProject(page, 'motion-remote');
    const bob = await addBob(page, browser);
    await recordViewTransitions(page);

    await createTask(bob, 'From Bob');
    await refocus(page);
    await expect(card(page, 'Todo', 'From Bob')).toBeVisible();
    await viewTransitionsDone(page);
    expect((await seenViewTransitions(page)).some((p) => p.startsWith('::view-transition-new(card-'))).toBe(true);
  });

  test('my own move does not run a card view transition', async ({ page }) => {
    await signUpWithProject(page, 'motion-local');
    await createTask(page, 'Mine');
    await recordViewTransitions(page);

    await lift(page, card(page, 'Todo', 'Mine'));
    await dropOn(page, column(page, 'In Progress'));
    await expect(card(page, 'In Progress', 'Mine')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await viewTransitionsDone(page);
    expect((await seenViewTransitions(page)).filter((p) => p.includes('(card-'))).toEqual([]);
  });
});

export { card, column, recordViewTransitions, seenViewTransitions, signUpWithProject, viewTransitionsDone };
