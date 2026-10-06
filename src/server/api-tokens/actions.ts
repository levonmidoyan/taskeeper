'use server';

import { revalidatePath } from 'next/cache';
import { withAction, type Result } from '@/lib/result';
import { requireUser } from '@/lib/session';
import { createApiToken, revokeApiToken, type CreateApiTokenInput } from './service';

export async function createApiTokenAction(input: CreateApiTokenInput): Promise<Result<{ id: string; token: string }>> {
  return withAction(async () => {
    const result = await createApiToken(await requireUser(), input);
    if (result.ok) revalidatePath('/settings/api-tokens');
    return result;
  });
}

export async function revokeApiTokenAction(id: string): Promise<Result<null>> {
  return withAction(async () => {
    const result = await revokeApiToken(await requireUser(), id);
    if (result.ok) revalidatePath('/settings/api-tokens');
    return result;
  });
}
