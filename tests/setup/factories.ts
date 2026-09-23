import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { member, organization, user, workspaceSettings } from '@/db';
import { newId } from '@/lib/ids';

export async function createUser(email: string, name = 'Test User') {
  const id = newId();
  await db.insert(user).values({ id, name, email });
  return { id, email, name };
}

export async function createWorkspace(ownerId: string, name: string, slug: string) {
  const id = newId();
  await db.insert(organization).values({ id, name, slug });
  await db.insert(workspaceSettings).values({ workspaceId: id });
  await db.insert(member).values({ id: newId(), organizationId: id, userId: ownerId, role: 'owner' });
  return { id, name, slug };
}

export async function joinWorkspace(userId: string, workspaceId: string, role: 'admin' | 'member') {
  const id = newId();
  await db.insert(member).values({ id, organizationId: workspaceId, userId, role });
  return {
    id,
    async remove() {
      await db.delete(member).where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)));
    },
  };
}
