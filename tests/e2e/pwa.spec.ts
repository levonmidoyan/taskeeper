import { expect, test } from '@playwright/test';

test('the app is installable: manifest, icons and a service worker', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Taskeeper', display: 'standalone', start_url: '/' });
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);

  const sw = await request.get('/sw.js');
  expect(sw.headers()['cache-control']).toContain('no-cache');

  await page.goto('/auth/sign-in');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
});

test('the offline page renders without signing in', async ({ page }) => {
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
});
