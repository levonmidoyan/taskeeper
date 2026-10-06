import { sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { pool } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { prepareAccountDeletion } from '@/server/account/deletion';
import { emitChangeFor } from '@/server/changes/service';
import { changeMemberRole } from '@/server/members/service';

// Two writes at once, interleaved on purpose. A spare connection holds a row
// lock so each side stops at a known point; once both are waiting the lock is
// let go. With the wrong lock order Postgres reports "deadlock detected" about
// a second later (deadlock_timeout), so each test fails rather than hangs.

beforeEach(resetDb);
afterAll(closeDb);

const held: PoolClient[] = [];

/** A connection with an open transaction, outside the pool's normal use. */
async function openTx(): Promise<PoolClient> {
  const client = await pool.connect();
  held.push(client);
  await client.query('BEGIN');
  return client;
}

afterEach(async () => {
  for (const client of held.splice(0)) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

/** Sessions in this database currently stuck behind another's lock. */
async function lockWaiters(): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
  `);
  return rows[0].n;
}

async function until(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// Leaves a nested loop driven by a scan of the member table, which returns a
// user's memberships in the order they joined.
const MEMBER_FIRST_PLAN = [
  'enable_indexscan', 'enable_indexonlyscan', 'enable_bitmapscan', 'enable_hashjoin', 'enable_mergejoin',
];

/**
 * Applies MEMBER_FIRST_PLAN to every pooled connection for the duration of run().
 * SET is per session and pooled sessions are reused, so each one is checked out
 * at once, set, and handed back.
 */
async function withMemberFirstPlan(run: () => Promise<void>): Promise<void> {
  const each = async (statement: (name: string) => string) => {
    const clients = await Promise.all(Array.from({ length: pool.options.max }, () => pool.connect()));
    try {
      for (const client of clients) {
        for (const name of MEMBER_FIRST_PLAN) await client.query(statement(name));
      }
    } finally {
      for (const client of clients) client.release();
    }
  };
  await each((name) => `SET ${name} = off`);
  try {
    await run();
  } finally {
    await each((name) => `RESET ${name}`);
  }
}

/** Remembers whether a promise has settled, without awaiting it. */
function track<T>(promise: Promise<T>) {
  const state = { settled: false, error: undefined as unknown, promise };
  promise.then(
    () => { state.settled = true; },
    (error) => { state.settled = true; state.error = error; },
  );
  return state;
}

describe('lock order', () => {
  it('two account deletions sharing workspaces do not deadlock', async () => {
    const owner = await createUser('lo-owner@example.com');
    const [w1, w2] = [
      await createWorkspace(owner.id, 'One', 'lo-one'),
      await createWorkspace(owner.id, 'Two', 'lo-two'),
    ].sort((a, b) => (a.id < b.id ? -1 : 1));

    // Joined in opposite orders. The membership query has no ORDER BY: through
    // the (organization_id, user_id) index it happens to return id order, but
    // another plan returns join order. That plan runs below, so the two
    // deletions meet w1 and w2 opposite ways round unless the code sorts.
    const ada = await createUser('lo-ada@example.com');
    const bob = await createUser('lo-bob@example.com');
    await joinWorkspace(ada.id, w1.id, 'member');
    await joinWorkspace(bob.id, w2.id, 'member');
    await joinWorkspace(ada.id, w2.id, 'member');
    await joinWorkspace(bob.id, w1.id, 'member');

    // Counter rows exist, so each deletion's bump is a row update it must lock.
    await emitChangeFor(w1.id, db);
    await emitChangeFor(w2.id, db);

    // Hold the lower id's counter row: a deletion that starts there waits
    // holding nothing; one that starts at w2 waits holding w2.
    let results: PromiseSettledResult<void>[] = [];
    await withMemberFirstPlan(async () => {
      // Not openTx: withMemberFirstPlan needs every connection back before it resets them.
      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT 1 FROM workspace_change WHERE workspace_id = $1 FOR UPDATE', [w1.id]);

        const deletions = [prepareAccountDeletion(ada.id), prepareAccountDeletion(bob.id)];
        await until(async () => (await lockWaiters()) >= 2, 'both deletions to wait');

        await blocker.query('COMMIT');
        results = await Promise.allSettled(deletions);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
    });
    expect(results.map((r) => (r.status === 'rejected' ? String(r.reason) : 'ok'))).toEqual(['ok', 'ok']);

    const { rows } = await db.execute<{ version: number }>(sql`
      SELECT version::int AS version FROM workspace_change WHERE workspace_id IN (${w1.id}, ${w2.id})
    `);
    // 1 from setup + 1 per deletion, in each workspace.
    expect(rows.map((r) => r.version)).toEqual([3, 3]);
  });

  it("an owner change does not deadlock against a workspace's first counter insert", async () => {
    const owner = await createUser('lo-o@example.com');
    const target = await createUser('lo-t@example.com');
    const ws = await createWorkspace(owner.id, 'Acme', 'lo-acme');
    const joined = await joinWorkspace(target.id, ws.id, 'member');
    const ctx: WorkspaceContext = {
      userId: owner.id, workspaceId: ws.id, slug: 'lo-acme', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC',
    };

    // Stop the role change after lockWorkspace, before its own emitChange.
    const blocker = await openTx();
    await blocker.query('SELECT 1 FROM member WHERE id = $1 FOR UPDATE', [joined.id]);
    const change = track(changeMemberRole(ctx, { userId: target.id, role: 'admin' }));
    await until(async () => (await lockWaiters()) >= 1, 'the role change to reach the member update');

    // Another write's first bump: its foreign-key check takes KEY SHARE on the
    // workspace row, which must not wait on lockWorkspace.
    const other = await openTx();
    const insert = track(other.query(
      `INSERT INTO workspace_change (workspace_id, version) VALUES ($1, 1)
       ON CONFLICT (workspace_id) DO UPDATE SET version = workspace_change.version + 1`,
      [ws.id],
    ));
    await until(async () => insert.settled || (await lockWaiters()) >= 2, 'the insert to finish or wait');

    // The role change now reaches emitChange and queues behind the open insert.
    await blocker.query('COMMIT');
    await until(async () => change.settled || (await lockWaiters()) >= 1, 'the role change to reach emitChange');
    await insert.promise.catch(() => {});
    expect(insert.error).toBeUndefined();
    await other.query('COMMIT');

    const result = await change.promise;
    expect(result.ok, result.ok ? undefined : result.error).toBe(true);

    const { rows } = await db.execute<{ version: number }>(sql`
      SELECT version::int AS version FROM workspace_change WHERE workspace_id = ${ws.id}
    `);
    expect(rows[0].version).toBe(2);
  });
});
