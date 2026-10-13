import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trigger = vi.fn(async () => ({}));
vi.mock('pusher', () => ({
  default: class {
    trigger = trigger;
  },
}));

// Captures after() callbacks so a test can run them "after the response".
const afterCallbacks: Array<() => unknown> = [];
let outsideRequest = false;
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((callback: () => unknown) => {
    if (outsideRequest) throw new Error('`after` was called outside a request scope.');
    afterCallbacks.push(callback);
  }),
}));

const { closeDb, db, resetDb } = await import('../setup/db');
const { createUser, createWorkspace } = await import('../setup/factories');
const { emitChangeFor } = await import('@/server/changes/service');
const { publishWorkspaceVersion } = await import('@/server/changes/publish');
const { after } = await import('next/server');

const PUSHER_ENV = { PUSHER_APP_ID: '1', PUSHER_KEY: 'key', PUSHER_SECRET: 'secret', PUSHER_CLUSTER: 'eu' };

// Next starts a request's after() callbacks together (an unbounded queue).
async function runAfter() {
  await Promise.all(afterCallbacks.splice(0).map((callback) => callback()));
}

async function workspace() {
  const ada = await createUser('ada@example.com', 'Ada');
  return createWorkspace(ada.id, 'Acme', 'acme');
}

beforeEach(async () => {
  await resetDb();
  Object.assign(process.env, PUSHER_ENV);
  outsideRequest = false;
  afterCallbacks.length = 0;
});
afterEach(() => {
  for (const name of Object.keys(PUSHER_ENV)) delete process.env[name];
  vi.clearAllMocks();
});
afterAll(closeDb);

describe('schedulePublish via emitChangeFor', () => {
  it('publishes the committed version after the response', async () => {
    const ws = await workspace();
    await db.transaction((tx) => emitChangeFor(ws.id, tx));
    expect(trigger).not.toHaveBeenCalled();
    await runAfter();
    expect(trigger).toHaveBeenCalledWith(`private-workspace-${ws.id}`, 'change', { version: 1 });
  });

  it('a rolled-back write re-sends the committed version, never the rolled-back one', async () => {
    const ws = await workspace();
    await emitChangeFor(ws.id, db);
    await runAfter();
    trigger.mockClear();

    await expect(
      db.transaction(async (tx) => {
        await emitChangeFor(ws.id, tx);
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    await runAfter();
    expect(trigger).toHaveBeenCalledWith(`private-workspace-${ws.id}`, 'change', { version: 1 });
  });

  it('does nothing when Pusher is not configured', async () => {
    delete process.env.PUSHER_SECRET;
    const ws = await workspace();
    await emitChangeFor(ws.id, db);
    expect(after).not.toHaveBeenCalled();
    await runAfter();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('a request with several emits sends one message', async () => {
    const ws = await workspace();
    await db.transaction(async (tx) => {
      await emitChangeFor(ws.id, tx);
      await emitChangeFor(ws.id, tx);
    });
    await emitChangeFor(ws.id, db);
    expect(after).toHaveBeenCalledTimes(3);
    await runAfter();
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(`private-workspace-${ws.id}`, 'change', { version: 3 });
  });

  it('outside a request scope it waits for the commit, then publishes the committed version', async () => {
    const ws = await workspace();
    outsideRequest = true;
    await db.transaction(async (tx) => {
      await emitChangeFor(ws.id, tx);
      // Longer than the first commit check: an early publish would carry 0.
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(trigger).not.toHaveBeenCalled();
    });
    await vi.waitFor(() => expect(trigger).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    expect(trigger).toHaveBeenCalledWith(`private-workspace-${ws.id}`, 'change', { version: 1 });
  });

  it('outside a request scope a rolled-back write publishes nothing', async () => {
    const ws = await workspace();
    outsideRequest = true;
    await expect(
      db.transaction(async (tx) => {
        await emitChangeFor(ws.id, tx);
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    expect(trigger).not.toHaveBeenCalled();
  }, 10_000);

});

describe('publishWorkspaceVersion', () => {
  it('sends 0 for a workspace that never changed', async () => {
    const ws = await workspace();
    await publishWorkspaceVersion(ws.id);
    expect(trigger).toHaveBeenCalledWith(`private-workspace-${ws.id}`, 'change', { version: 0 });
  });

  it('calls before the counter is read share one publish; later calls send again', async () => {
    const ws = await workspace();
    await Promise.all([publishWorkspaceVersion(ws.id), publishWorkspaceVersion(ws.id)]);
    expect(trigger).toHaveBeenCalledTimes(1);
    await emitChangeFor(ws.id, db);
    afterCallbacks.length = 0;
    await publishWorkspaceVersion(ws.id);
    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger).toHaveBeenLastCalledWith(`private-workspace-${ws.id}`, 'change', { version: 1 });
  });

  it('logs and swallows a Pusher failure', async () => {
    const ws = await workspace();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    trigger.mockRejectedValueOnce(new Error('401 invalid signature'));
    await expect(publishWorkspaceVersion(ws.id)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
