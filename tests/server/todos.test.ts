import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { todo, user } from '@/db';
import { newId } from '@/lib/ids';
import { positionBetween } from '@/lib/position';

beforeEach(resetDb);
afterAll(closeDb);

describe('todo table', () => {
  it('stores an item and cascades when its owner is deleted', async () => {
    const ada = await createUser('ada@example.com');
    const ws = await createWorkspace(ada.id, 'Acme', 'acme');

    await db.insert(todo).values({
      id: newId(), userId: ada.id, workspaceId: ws.id, title: 'Buy milk',
      dueDate: '2026-10-01', position: positionBetween(null, null),
    });

    const [row] = await db.select().from(todo);
    expect(row.title).toBe('Buy milk');
    expect(row.dueDate).toBe('2026-10-01');
    expect(row.completedAt).toBeNull();

    await db.delete(user).where(eq(user.id, ada.id));
    expect(await db.select().from(todo)).toHaveLength(0);
  });
});
