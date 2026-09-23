import { unstable_rethrow } from 'next/navigation';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err(error: string): Result<never> {
  return { ok: false, error };
}

/** Thrown by requireRole; converted to a Result by withAction. */
export class ForbiddenError extends Error {
  constructor(message = 'You do not have permission to do that.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Wraps a Server Action body so nothing ever throws across the client boundary
 * (spec §5). Expected failures return their own message; anything unexpected is
 * logged server-side and returned as a generic message, so internal detail such
 * as SQL text never reaches the browser.
 */
export async function withAction<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    // Next's redirect()/notFound() signal by throwing a framework-internal
    // error (NEXT_REDIRECT / NEXT_HTTP_ERROR_FALLBACK;404). Every requireWorkspace
    // call funnels through here, so those must escape uncaught rather than be
    // swallowed and reported as a generic failure.
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) return err(error.message);
    console.error('[action]', error);
    return err('Something went wrong. Please try again.');
  }
}
