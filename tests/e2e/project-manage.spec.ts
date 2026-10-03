import { expect, test, type Page } from '@playwright/test';

async function signUpWithProject(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Project Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Projects ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Website', level: 1 })).toBeVisible();
}

const railLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name, exact: true });

test('a project is renamed, archived, restored and deleted from its menu', async ({ page }) => {
  await signUpWithProject(page, 'manage');
  const projectUrl = page.url();
  const workspaceUrl = projectUrl.replace(/\/projects\/[^/?]+$/, '');

  await page.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const nameField = page.getByRole('dialog').getByLabel('Project name');
  await nameField.fill('Marketing site');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Marketing site', level: 1 })).toBeVisible();
  await expect(railLink(page, 'Marketing site')).toBeVisible();

  await page.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page).toHaveURL(workspaceUrl);
  await expect(railLink(page, 'Marketing site')).toHaveCount(0);

  // An archived board's old URL 404s rather than opening read-write.
  await page.goto(projectUrl);
  await expect(page.getByRole('heading', { name: 'Marketing site', level: 1 })).toHaveCount(0);

  await page.goto(`${workspaceUrl}/settings/projects`);
  const archived = page.getByRole('list', { name: 'Archived projects' });
  await expect(archived.getByText('Marketing site')).toBeVisible();
  await archived.getByRole('button', { name: 'Restore Marketing site' }).click();
  await expect(page.getByText('No archived projects.')).toBeVisible();
  await expect(railLink(page, 'Marketing site')).toBeVisible();

  await railLink(page, 'Marketing site').click();
  await expect(page.getByRole('heading', { name: 'Marketing site', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(workspaceUrl);
  await expect(railLink(page, 'Marketing site')).toHaveCount(0);

  await page.goto(`${workspaceUrl}/settings/projects`);
  await expect(page.getByText('No archived projects.')).toBeVisible();
});

test('a project is managed from its rail row without leaving the current page', async ({ page }) => {
  await signUpWithProject(page, 'rail');
  const workspaceUrl = page.url().replace(/\/projects\/[^/?]+$/, '');
  const rail = page.getByRole('navigation', { name: 'Workspace' });

  await page.goto(`${workspaceUrl}/starred`);
  await railLink(page, 'Website').hover();
  await rail.getByRole('button', { name: 'Actions for Website' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('dialog').getByLabel('Project name').fill('Docs');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(railLink(page, 'Docs')).toBeVisible();
  await expect(page).toHaveURL(`${workspaceUrl}/starred`);

  await railLink(page, 'Docs').hover();
  await rail.getByRole('button', { name: 'Actions for Docs' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(railLink(page, 'Docs')).toHaveCount(0);
  await expect(page).toHaveURL(`${workspaceUrl}/starred`);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(railLink(page, 'Docs')).toBeVisible();
  await expect(page).toHaveURL(`${workspaceUrl}/starred`);

  await railLink(page, 'Docs').hover();
  await rail.getByRole('button', { name: 'Actions for Docs' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(railLink(page, 'Docs')).toHaveCount(0);
  await expect(page).toHaveURL(`${workspaceUrl}/starred`);
});
