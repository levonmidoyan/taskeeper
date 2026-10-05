import { eq } from 'drizzle-orm';
import { db, user } from '@/db';
import type { ApiMe } from './contract/shapes';

export async function getApiUser(userId: string): Promise<ApiMe | null> {
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row ?? null;
}
