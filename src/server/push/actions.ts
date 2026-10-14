'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { PushPrefs } from '@/lib/push';
import { withAction, type Result } from '@/lib/result';
import { requireUser } from '@/lib/session';
import { sendTestPush, subscribePush, unsubscribePush, updatePushPrefs } from './service';

export async function subscribePushAction(subscription: unknown): Promise<Result<null>> {
  return withAction(async () =>
    subscribePush(await requireUser(), subscription, (await headers()).get('user-agent')),
  );
}

export async function unsubscribePushAction(endpoint: string): Promise<Result<null>> {
  return withAction(async () => unsubscribePush(await requireUser(), endpoint));
}

export async function updatePushPrefsAction(input: PushPrefs): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updatePushPrefs(await requireUser(), input);
    if (result.ok) revalidatePath('/settings/preferences');
    return result;
  });
}

export async function sendTestPushAction(): Promise<Result<{ sent: number; failed: number }>> {
  return withAction(async () => sendTestPush(await requireUser()));
}
