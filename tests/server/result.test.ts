import { describe, expect, it } from 'vitest';
import { notFound, redirect } from 'next/navigation';
import { err, ForbiddenError, ok, withAction } from '@/lib/result';

describe('withAction', () => {
  it('surfaces a ForbiddenError\'s own message, tagged forbidden', async () => {
    const result = await withAction(async () => {
      throw new ForbiddenError('You cannot do that.');
    });

    expect(result).toEqual({ ok: false, error: 'You cannot do that.', code: 'forbidden' });
  });

  it('tags an unexpected error internal', async () => {
    const result = await withAction(async () => {
      throw new Error('boom');
    });

    expect(result).toEqual({ ok: false, error: 'Something went wrong. Please try again.', code: 'internal' });
  });

  it('leaves a plain failure without a code key', async () => {
    const result = await withAction(async () => err('Nope.'));

    expect(result).toStrictEqual({ ok: false, error: 'Nope.' });
    expect(err('Gone.', 'not_found')).toStrictEqual({ ok: false, error: 'Gone.', code: 'not_found' });
  });

  it('returns only a generic message for an unexpected error, never the internal detail', async () => {
    const result = await withAction(async () => {
      throw new Error('relation "task" does not exist');
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Something went wrong. Please try again.');
      expect(result.error).not.toContain('relation');
      expect(result.error).not.toContain('task');
    }
  });

  it('passes success-path data through unchanged', async () => {
    const result = await withAction(async () => ok({ id: 'abc123' }));

    expect(result).toEqual({ ok: true, data: { id: 'abc123' } });
  });

  it('lets a redirect() interrupt escape instead of converting it to a Result', async () => {
    await expect(
      withAction(async () => {
        redirect('/sign-in');
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
  });

  it('lets a notFound() interrupt escape instead of converting it to a Result', async () => {
    await expect(
      withAction(async () => {
        notFound();
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404') });
  });
});
