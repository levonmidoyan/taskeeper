import { and, eq, isNull } from 'drizzle-orm';
import { db, user } from '@/db';

/**
 * The `picture` claim of a Google ID token, if it is an https URL. The token
 * was verified by Better Auth before it was stored, so it is only decoded here.
 */
function pictureFromIdToken(idToken: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString());
    const picture = typeof claims?.picture === 'string' ? new URL(claims.picture) : null;
    return picture?.protocol === 'https:' ? picture.href : null;
  } catch {
    return null;
  }
}

/**
 * Gives the user their Google photo when they have no image yet. Better Auth
 * copies the profile onto the user only when Google creates the account; an
 * account that signed up with a password and linked Google later stays without
 * one. Runs on every Google account write (link and sign-in), so accounts
 * linked before this existed pick the photo up at their next Google sign-in.
 * A photo the user already has, uploaded or from Google, is never replaced.
 * Returns whether the user's image was set.
 */
export async function fillImageFromGoogle(account: {
  providerId: string;
  userId: string;
  idToken?: string | null;
}): Promise<boolean> {
  if (account.providerId !== 'google' || !account.idToken) return false;
  const picture = pictureFromIdToken(account.idToken);
  if (!picture) return false;
  const updated = await db
    .update(user)
    .set({ image: picture })
    .where(and(eq(user.id, account.userId), isNull(user.image)))
    .returning({ id: user.id });
  return updated.length > 0;
}
