import { unstable_rethrow } from 'next/navigation';
import type { Result } from '@/lib/result';

/**
 * Client side of withAction. A Server Action returns a Result, but the call itself
 * can still reject: network drop, a deploy that retired the action id, an expired
 * session. Turned into an error Result, every caller's `!result.ok` branch handles
 * it, instead of a form stuck on "Saving…" or a transition throwing into error.tsx.
 */
export async function settle<T>(call: Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await call;
  } catch (error) {
    // An action's redirect()/notFound() still has to reach the router.
    unstable_rethrow(error);
    console.error('[action call]', error);
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
}
