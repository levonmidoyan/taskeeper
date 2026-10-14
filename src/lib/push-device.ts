'use client';

import { settle } from '@/lib/settle';
import { subscribePushAction, unsubscribePushAction } from '@/server/push/actions';

/** This browser's push subscription, or null (no worker, no push, or not subscribed). */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * The service worker push subscribes through. The layout registers it in production
 * only, so register it here when missing (next dev, or a registration that failed).
 * Bounded: `ready` never settles when the worker can't install, and the caller is
 * holding the form disabled until this returns.
 */
export async function pushRegistration(timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration())) {
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Service worker did not become ready')), timeoutMs);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Claims this browser's subscription for whoever is signed in now. The endpoint
 * belongs to the browser, so after an account switch it must stop delivering the
 * previous account's notifications. An idempotent upsert; false when it failed.
 */
export async function claimPushDevice(subscription: PushSubscription): Promise<boolean> {
  return (await settle(subscribePushAction(subscription.toJSON()))).ok;
}

/**
 * Before sign-out: forget this device on the server and in the browser, so the
 * next person here neither gets this account's pushes nor finds push already on.
 * Best effort, and bounded so a slow network never holds up signing out.
 */
export async function forgetPushDevice(): Promise<void> {
  const forget = async () => {
    const subscription = await currentPushSubscription();
    if (!subscription) return;
    await settle(unsubscribePushAction(subscription.endpoint));
    await subscription.unsubscribe();
  };
  await Promise.race([forget().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2000))]);
}
