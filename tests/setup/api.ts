import { createApiToken } from '@/server/api-tokens/service';
import { createUser } from './factories';

/** A user with one never-expiring API token. */
export async function apiUser(email: string, name = 'Ada') {
  const user = await createUser(email, name);
  const created = await createApiToken({ userId: user.id }, { name: 'test', expiresInDays: null });
  if (!created.ok) throw new Error(created.error);
  return { ...user, token: created.data.token, tokenId: created.data.id };
}
