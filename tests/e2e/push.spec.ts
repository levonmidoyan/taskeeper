import { expect, test, type Page } from '@playwright/test';

async function signUpWithWorkspace(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Push Tester');
  await page.getByLabel('Email', { exact: true }).fill(`push-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Push ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  return page.url();
}

// Headless Chromium has no real push service: stand in for PushManager (and the
// notification permission) so the flow (permission → subscribe → server row → off)
// runs end to end. The endpoint must be on a real push service's host, or the
// server refuses it. The fake subscription lives in localStorage so it outlives a
// page load, like the browser's real one.
test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['notifications']);
  await context.addInitScript(() => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/e2e-device';
    const KEY = 'e2e-push-subscribed';
    const fake = () => ({
      endpoint,
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'BPx'.padEnd(87, 'x'), auth: 'a'.repeat(22) } }),
      unsubscribe: async () => { localStorage.removeItem(KEY); return true; },
    }) as unknown as PushSubscription;
    PushManager.prototype.subscribe = async function () { localStorage.setItem(KEY, '1'); return fake(); };
    PushManager.prototype.getSubscription = async function () { return localStorage.getItem(KEY) ? fake() : null; };
    // Headless Chromium reports notifications as denied even when granted.
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    Notification.requestPermission = async () => 'granted';
  });
});

async function turnPushOn(page: Page) {
  await page.goto('/settings/preferences');
  const device = page.getByRole('switch', { name: 'Push on this device' });
  await expect(device).toBeEnabled();
  await device.click();
  await expect(device).toBeChecked();
}

test('turning push on stores this device, and per-kind toggles save', async ({ page }) => {
  await signUpWithWorkspace(page);
  await page.goto('/settings/preferences');

  const device = page.getByRole('switch', { name: 'Push on this device' });
  await expect(device).toBeEnabled();
  await device.click();
  await expect(device).toBeChecked();
  await expect(page.getByText('This device gets push notifications.')).toBeVisible();

  // The fake keys can't be encrypted to, so the send fails on the server, after
  // finding this device's stored row.
  await page.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByText('Could not reach your devices’ push service. Try again.')).toBeVisible();

  await page.getByRole('switch', { name: 'Project changes' }).click();
  await page.getByRole('button', { name: 'Save' }).last().click();
  await expect(page.getByText('Push settings updated.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Project changes' })).toBeChecked();
  await expect(device).toBeChecked();

  await device.click();
  await expect(page.getByText('Get notifications on this device, even when Taskeeper is closed.')).toBeVisible();
  await expect(device).not.toBeChecked();
});

test('signing out takes this device off the account', async ({ page }) => {
  await signUpWithWorkspace(page);
  await turnPushOn(page);

  await page.goto('/auth/sign-out');
  await expect(page).toHaveURL(/\/auth\/sign-in/);

  // The next person on this browser starts with push off.
  await signUpWithWorkspace(page);
  await page.goto('/settings/preferences');
  // The settled Off state, not the brief unchecked one while the device is read.
  await expect(page.getByText('Get notifications on this device, even when Taskeeper is closed.')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Push on this device' })).not.toBeChecked();
});

test('a device still subscribed follows whoever is signed in now', async ({ page, context }) => {
  await signUpWithWorkspace(page);
  await turnPushOn(page);

  // Another account on the same browser without signing out (session dropped, multi-session switch).
  await context.clearCookies();
  await signUpWithWorkspace(page);
  await page.goto('/settings/preferences');
  await expect(page.getByRole('switch', { name: 'Push on this device' })).toBeChecked();
  // The device's row is this user's now, so the test send finds it.
  await page.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByText('Could not reach your devices’ push service. Try again.')).toBeVisible();
});
