'use server';

import { revalidatePath } from 'next/cache';
import { withAction, type Result } from '@/lib/result';
import { requireUser } from '@/lib/session';
import { updateUserTimezone } from './service';

export async function updateUserTimezoneAction(timezone: string | null): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateUserTimezone(await requireUser(), timezone);
    // The zone applies in every workspace, so every page's dates may change.
    if (result.ok) revalidatePath('/', 'layout');
    return result;
  });
}
