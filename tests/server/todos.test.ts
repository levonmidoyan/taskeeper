import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { todo, user } from '@/db';
import { newId } from '@/lib/ids';
import { positionBetween } from '@/lib/position';
import type { WorkspaceContext } from '@/lib/session';
import { listTodos } from '@/server/todos/queries';
import { createTodo, deleteTodo, moveTodo, updateTodo } from '@/server/todos/service';

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
const ctxFor = (
  userId: string, workspaceId: string, slug: string, role: WorkspaceContext['role'] = 'owner',
): WorkspaceContext => ({ userId, workspaceId, slug, role, timezone: 'Asia/Yerevan' });

async function owner(email = 'ada@example.com', slug = 'acme') {
  const u = await createUser(email);
  const ws = await createWorkspace(u.id, 'Acme', slug);
  return { user: u, workspace: ws, ctx: ctxFor(u.id, ws.id, slug) };
}

async function add(ctx: WorkspaceContext, title: string) {
  const result = await createTodo(ctx, { title });
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

const openTitles = async (ctx: WorkspaceContext) => (await listTodos(ctx)).open.map((t) => t.title);
const doneTitles = async (ctx: WorkspaceContext) => (await listTodos(ctx)).done.map((t) => t.title);

describe('createTodo', () => {
  it('appends to the end of the open list', async () => {
    const { ctx } = await owner();
    await add(ctx, 'One');
    await add(ctx, 'Two');
    await add(ctx, 'Three');
    expect(await openTitles(ctx)).toEqual(['One', 'Two', 'Three']);
  });

  it('trims the title and keeps an optional due date', async () => {
    const { ctx } = await owner();
    await createTodo(ctx, { title: '  Buy milk  ', dueDate: '2026-10-01' });
    const [item] = (await listTodos(ctx)).open;
    expect(item).toMatchObject({ title: 'Buy milk', dueDate: '2026-10-01', completedAt: null });
  });

  it('rejects a blank or oversized title', async () => {
    const { ctx } = await owner();
    expect((await createTodo(ctx, { title: '   ' })).ok).toBe(false);
    expect((await createTodo(ctx, { title: 'x'.repeat(201) })).ok).toBe(false);
    expect(await openTitles(ctx)).toEqual([]);
  });

  it('rejects an impossible due date', async () => {
    const { ctx } = await owner();
    expect((await createTodo(ctx, { title: 'A', dueDate: '2026-02-30' })).ok).toBe(false);
    expect((await createTodo(ctx, { title: 'B', dueDate: 'tomorrow' })).ok).toBe(false);
    expect(await openTitles(ctx)).toEqual([]);
  });
});

describe('updateTodo', () => {
  it('renames and sets or clears the due date', async () => {
    const { ctx } = await owner();
    const id = await add(ctx, 'Draft');

    expect((await updateTodo(ctx, { todoId: id, title: 'Final', dueDate: '2026-10-02' })).ok).toBe(true);
    expect((await listTodos(ctx)).open[0]).toMatchObject({ title: 'Final', dueDate: '2026-10-02' });

    expect((await updateTodo(ctx, { todoId: id, dueDate: null })).ok).toBe(true);
    expect((await listTodos(ctx)).open[0].dueDate).toBeNull();
  });

  it('rejects renaming to a blank title', async () => {
    const { ctx } = await owner();
    const id = await add(ctx, 'Keep me');
    expect((await updateTodo(ctx, { todoId: id, title: '  ' })).ok).toBe(false);
    expect(await openTitles(ctx)).toEqual(['Keep me']);
  });

  it('moves a checked item to Completed, newest first', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    const b = await add(ctx, 'B');
    await add(ctx, 'C');

    await updateTodo(ctx, { todoId: a, done: true });
    await new Promise((r) => setTimeout(r, 5));
    await updateTodo(ctx, { todoId: b, done: true });

    const lists = await listTodos(ctx);
    expect(lists.open.map((t) => t.title)).toEqual(['C']);
    expect(lists.done.map((t) => t.title)).toEqual(['B', 'A']);
    expect(lists.done[0].completedAt).toBeInstanceOf(Date);
  });

  it('keeps the original completion time when checked again', async () => {
    const { ctx } = await owner();
    const id = await add(ctx, 'A');
    await updateTodo(ctx, { todoId: id, done: true });
    const first = (await listTodos(ctx)).done[0].completedAt;
    await updateTodo(ctx, { todoId: id, done: true });
    expect((await listTodos(ctx)).done[0].completedAt).toEqual(first);
  });

  it('sends an unchecked item to the end of the open list', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    await add(ctx, 'B');
    await add(ctx, 'C');

    await updateTodo(ctx, { todoId: a, done: true });
    await updateTodo(ctx, { todoId: a, done: false });

    expect(await openTitles(ctx)).toEqual(['B', 'C', 'A']);
    expect(await doneTitles(ctx)).toEqual([]);
  });

  it('returns not found for an unknown id', async () => {
    const { ctx } = await owner();
    expect(await updateTodo(ctx, { todoId: 'nope', title: 'X' }))
      .toEqual({ ok: false, error: 'To-do not found.' });
  });
});

describe('moveTodo', () => {
  it('places an item between two neighbours', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    const b = await add(ctx, 'B');
    const c = await add(ctx, 'C');

    expect((await moveTodo(ctx, { todoId: c, beforeId: a, afterId: b })).ok).toBe(true);
    expect(await openTitles(ctx)).toEqual(['A', 'C', 'B']);

    expect((await moveTodo(ctx, { todoId: b, beforeId: null, afterId: a })).ok).toBe(true);
    expect(await openTitles(ctx)).toEqual(['B', 'A', 'C']);

    expect((await moveTodo(ctx, { todoId: b, beforeId: c, afterId: null })).ok).toBe(true);
    expect(await openTitles(ctx)).toEqual(['A', 'C', 'B']);
  });

  it('refuses to reorder a completed item', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    const b = await add(ctx, 'B');
    await updateTodo(ctx, { todoId: a, done: true });
    expect((await moveTodo(ctx, { todoId: a, beforeId: null, afterId: b })).ok).toBe(false);
  });

  it('refuses a completed, self or out-of-order neighbour', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    const b = await add(ctx, 'B');
    const c = await add(ctx, 'C');
    await updateTodo(ctx, { todoId: a, done: true });

    expect((await moveTodo(ctx, { todoId: c, beforeId: a, afterId: b })).ok).toBe(false);
    expect((await moveTodo(ctx, { todoId: c, beforeId: c, afterId: null })).ok).toBe(false);
    // before must sort ahead of after; a stale client could send them swapped.
    expect((await moveTodo(ctx, { todoId: c, beforeId: b, afterId: b })).ok).toBe(false);
    expect(await openTitles(ctx)).toEqual(['B', 'C']);
  });
});

describe('deleteTodo', () => {
  it('removes one item', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    await add(ctx, 'B');
    expect((await deleteTodo(ctx, { todoId: a })).ok).toBe(true);
    expect(await openTitles(ctx)).toEqual(['B']);
    expect(await deleteTodo(ctx, { todoId: a })).toEqual({ ok: false, error: 'To-do not found.' });
  });
});

describe('privacy', () => {
  it('hides a member’s list from everyone else in the workspace, admins and owners included', async () => {
    const { workspace, ctx: ownerCtx } = await owner();
    const mem = await createUser('mem@example.com');
    await joinWorkspace(mem.id, workspace.id, 'member');
    const memCtx = ctxFor(mem.id, workspace.id, 'acme', 'member');
    const adm = await createUser('adm@example.com');
    await joinWorkspace(adm.id, workspace.id, 'admin');
    const admCtx = ctxFor(adm.id, workspace.id, 'acme', 'admin');

    const secret = await add(memCtx, 'Secret');
    const other = await add(memCtx, 'Other');

    for (const intruder of [ownerCtx, admCtx]) {
      expect(await listTodos(intruder)).toEqual({ open: [], done: [] });
      expect(await updateTodo(intruder, { todoId: secret, title: 'Pwned' }))
        .toEqual({ ok: false, error: 'To-do not found.' });
      expect(await updateTodo(intruder, { todoId: secret, done: true }))
        .toEqual({ ok: false, error: 'To-do not found.' });
      expect((await moveTodo(intruder, { todoId: secret, beforeId: other, afterId: null })).ok).toBe(false);
      expect(await deleteTodo(intruder, { todoId: secret }))
        .toEqual({ ok: false, error: 'To-do not found.' });
    }

    expect(await openTitles(memCtx)).toEqual(['Secret', 'Other']);
  });

  it('refuses another user’s item as a move neighbour', async () => {
    const { workspace, ctx: ownerCtx } = await owner();
    const mem = await createUser('mem@example.com');
    await joinWorkspace(mem.id, workspace.id, 'member');
    const memCtx = ctxFor(mem.id, workspace.id, 'acme', 'member');

    const mine = await add(ownerCtx, 'Mine');
    await add(ownerCtx, 'Also mine');
    const theirs = await add(memCtx, 'Theirs');

    expect((await moveTodo(ownerCtx, { todoId: mine, beforeId: theirs, afterId: null })).ok).toBe(false);
    expect(await openTitles(ownerCtx)).toEqual(['Mine', 'Also mine']);
  });

  it('keeps a separate list per workspace for the same user', async () => {
    const { user: ada, ctx: acme } = await owner();
    const ws2 = await createWorkspace(ada.id, 'Beta', 'beta');
    const beta = ctxFor(ada.id, ws2.id, 'beta');

    const inAcme = await add(acme, 'Acme item');
    await add(beta, 'Beta item');

    expect(await openTitles(acme)).toEqual(['Acme item']);
    expect(await openTitles(beta)).toEqual(['Beta item']);
    expect(await updateTodo(beta, { todoId: inAcme, title: 'Moved?' }))
      .toEqual({ ok: false, error: 'To-do not found.' });
    expect(await deleteTodo(beta, { todoId: inAcme }))
      .toEqual({ ok: false, error: 'To-do not found.' });
  });
});
