// Visual check for the UI reset (spec §8). Needs a running server:
//   DATABASE_URL=$DATABASE_URL_TEST yarn build && DATABASE_URL=$DATABASE_URL_TEST yarn start
// then: node scripts/screenshots.mjs [baseURL]
// Writes test-results/screens/<page>-<width>-<theme>.png for review.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = 'test-results/screens';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const setup = await browser.newPage({ baseURL: base });
const stamp = Date.now();
await setup.goto('/sign-up');
await setup.getByLabel('Name').fill('Screen Shot');
await setup.getByLabel('Email').fill(`screens-${stamp}@example.com`);
await setup.getByLabel('Password').fill('correct-horse-battery');
await setup.getByRole('button', { name: 'Create account' }).click();
await setup.getByLabel('Workspace name').fill(`Screens ${stamp}`);
await setup.getByRole('button', { name: 'Create workspace' }).click();
await setup.getByRole('button', { name: 'New project' }).click();
await setup.getByLabel('Project name').fill('Website');
await setup.getByRole('button', { name: 'Create project' }).click();
for (const title of ['Write the landing copy', 'Pick a hero image', 'Ship it']) {
  await setup.getByPlaceholder('Add a task…').fill(title);
  await setup.getByPlaceholder('Add a task…').press('Enter');
  await setup.getByText(title).waitFor();
}
const projectUrl = setup.url();
const workspaceUrl = new URL(projectUrl).pathname.split('/').slice(0, 2).join('/');
const storage = await setup.context().storageState();
await setup.close();

const pages = [
  ['sign-in', '/sign-in', false],
  ['home', workspaceUrl, true],
  ['list', new URL(projectUrl).pathname, true],
  ['board', `${new URL(projectUrl).pathname}/board`, true],
  ['settings-general', `${workspaceUrl}/settings/general`, true],
  ['settings-members', `${workspaceUrl}/settings/members`, true],
];

for (const width of [1280, 390]) {
  for (const theme of ['light', 'dark']) {
    for (const [name, path, authed] of pages) {
      const context = await browser.newContext({
        baseURL: base,
        viewport: { width, height: 900 },
        storageState: authed ? storage : undefined,
      });
      // next-themes reads localStorage "theme" before first paint.
      await context.addInitScript((t) => localStorage.setItem('theme', t), theme);
      const page = await context.newPage();
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${out}/${name}-${width}-${theme}.png`, fullPage: true });
      if (name === 'list') {
        await page.getByRole('button', { name: 'Write the landing copy', exact: true }).click();
        await page.getByRole('dialog').waitFor();
        await page.screenshot({ path: `${out}/task-dialog-${width}-${theme}.png`, fullPage: true });
      }
      await context.close();
    }
  }
}

await browser.close();
console.log(`screenshots written to ${out}/`);
