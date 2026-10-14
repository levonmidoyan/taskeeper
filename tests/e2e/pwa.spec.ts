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

test('the offline page is self-contained, so it still works after a deploy', async ({ request }) => {
  const res = await request.get('/offline.html');
  expect(res.ok()).toBe(true);
  // No build-hashed assets: the worker caches this one file and nothing else.
  expect(await res.text()).not.toContain('/_next/');
});

test('a navigation without a network shows the offline page', async ({ page, context }) => {
  await page.goto('/auth/sign-in');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  await context.setOffline(true);
  await page.goto('/auth/sign-in').catch(() => {});
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try again' })).toBeVisible();
  await context.setOffline(false);
});
