import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { notification, task, userSettings } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { archiveProject, createProject } from '@/server/projects/service';
import { getProject } from '@/server/projects/queries';
import { claimNotifications, selectDueDigests, selectDueReminders } from '@/server/reminders/select';
import { setTaskReminders } from '@/server/reminders/service';
import { createTask, updateTask } from '@/server/tasks/service';
import { updateReminderPrefs, updateUserTimezone } from '@/server/user-settings/service';

beforeEach(resetDb);
afterAll(closeDb);

const at = (iso: string) => new Date(iso);

/** Workspace in Asia/Yerevan (the factory default), one project, one task due 2026-10-10. */
async function setup(slug = 'ws-sel') {
  const ada = await createUser(`${slug}@example.com`, 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: ada.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan', workspaceTimezone: 'Asia/Yerevan',
  };
  const project = await createProject(ctx, { name: 'Website' });
  if (!project.ok) throw new Error();
  const detail = await getProject(ctx, project.data.id);
  const made = await createTask(ctx, { projectId: project.data.id, title: 'Ship', dueDate: '2026-10-10', assigneeId: ada.id });
  if (!made.ok) throw new Error();
  return { ctx, ws, projectId: project.data.id, statuses: detail!.statuses, taskId: made.data.id };
}

describe('selectDueReminders', () => {
  it('is due from the local hour on, for 36 hours', async () => {
    const { ctx, taskId } = await setup();
    await setTaskReminders(ctx, { taskId, offsets: [1] });

    expect(await selectDueReminders(at('2026-10-09T04:59:00Z'))).toEqual([]);
    expect(await selectDueReminders(at('2026-10-09T05:00:00Z'))).toEqual([{
      kind: 'reminder', userId: ctx.userId, workspaceId: ctx.workspaceId, taskId,
      dedupeKey: `rem:${taskId}:${ctx.userId}:2026-10-10:1`,
      data: { title: 'Ship', projectName: 'Website', dueDate: '2026-10-10', offsetDays: 1 },
    }]);
    expect(await selectDueReminders(at('2026-10-10T16:59:00Z'))).toHaveLength(1);
    expect(await selectDueReminders(at('2026-10-10T17:00:00Z'))).toEqual([]);
  });

  it('uses the user’s own zone and hour over the workspace’s', async () => {
    const { ctx, taskId } = await setup();
    await updateUserTimezone(ctx, 'America/Los_Angeles');
    await setTaskReminders(ctx, { taskId, offsets: [0] });

    expect(await selectDueReminders(at('2026-10-10T15:59:00Z'))).toEqual([]);
    expect(await selectDueReminders(at('2026-10-10T16:00:00Z'))).toHaveLength(1);

    await updateReminderPrefs(ctx, { reminderHour: 18, digestEnabled: true });
    expect(await selectDueReminders(at('2026-10-10T16:00:00Z'))).toEqual([]);
    expect(await selectDueReminders(at('2026-10-11T01:00:00Z'))).toHaveLength(1);
  });

  it('skips done, archived, undated, archived-project and ex-member tasks', async () => {
    const { ctx, ws, projectId, statuses, taskId } = await setup();
    const now = at('2026-10-10T06:00:00Z');
    await setTaskReminders(ctx, { taskId, offsets: [0] });
    expect(await selectDueReminders(now)).toHaveLength(1);

    const done = statuses.find((s) => s.isDone)!;
    await updateTask(ctx, { taskId, statusId: done.id });
    expect(await selectDueReminders(now)).toEqual([]);
    await updateTask(ctx, { taskId, statusId: statuses[0].id });

    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, taskId));
    expect(await selectDueReminders(now)).toEqual([]);
    await db.update(task).set({ archivedAt: null }).where(eq(task.id, taskId));

    await updateTask(ctx, { taskId, dueDate: null });
    expect(await selectDueReminders(now)).toEqual([]);
    await updateTask(ctx, { taskId, dueDate: '2026-10-10' });

    const bob = await createUser('bob-sel@example.com', 'Bob');
    const membership = await joinWorkspace(bob.id, ws.id, 'member');
    await setTaskReminders({ ...ctx, userId: bob.id, role: 'member' }, { taskId, offsets: [0] });
    expect(await selectDueReminders(now)).toHaveLength(2);
    await membership.remove();
    expect((await selectDueReminders(now)).map((d) => d.userId)).toEqual([ctx.userId]);

    await archiveProject(ctx, { projectId });
    expect(await selectDueReminders(now)).toEqual([]);
  });

  it('skips a zone Postgres does not know, without failing the others', async () => {
    const a = await setup('ws-sel-a');
    const b = await setup('ws-sel-b');
    await setTaskReminders(a.ctx, { taskId: a.taskId, offsets: [0] });
    await setTaskReminders(b.ctx, { taskId: b.taskId, offsets: [0] });
    // Written directly: the service would refuse it.
    await db.insert(userSettings).values({ userId: a.ctx.userId, timezone: 'Mars/Olympus' });

    const due = await selectDueReminders(at('2026-10-10T06:00:00Z'));

    expect(due.map((d) => d.userId)).toEqual([b.ctx.userId]);
  });

  it('a moved due date makes a new key; moving it back gives the old one', async () => {
    const { ctx, taskId } = await setup();
    await setTaskReminders(ctx, { taskId, offsets: [0] });
    const [first] = await selectDueReminders(at('2026-10-10T06:00:00Z'));

    await updateTask(ctx, { taskId, dueDate: '2026-10-11' });
    const [moved] = await selectDueReminders(at('2026-10-11T06:00:00Z'));
    expect(moved.dedupeKey).not.toBe(first.dedupeKey);

    await updateTask(ctx, { taskId, dueDate: '2026-10-10' });
    const [back] = await selectDueReminders(at('2026-10-10T06:00:00Z'));
    expect(back.dedupeKey).toBe(first.dedupeKey);
  });
});

describe('selectDueDigests', () => {
  it('lists my tasks due today and overdue once the hour has passed', async () => {
    const { ctx, projectId } = await setup();
    const late = await createTask(ctx, { projectId, title: 'Late', dueDate: '2026-10-08', assigneeId: ctx.userId });
    await createTask(ctx, { projectId, title: 'Later', dueDate: '2026-10-12', assigneeId: ctx.userId });
    if (!late.ok) throw new Error();

    const [digest] = await selectDueDigests(at('2026-10-10T05:00:00Z'));

    expect(digest).toMatchObject({
      kind: 'digest', userId: ctx.userId, workspaceId: ctx.workspaceId, taskId: null,
      dedupeKey: `dig:${ctx.userId}:${ctx.workspaceId}:2026-10-10`,
      data: { localDate: '2026-10-10', dueToday: 1, overdue: 1 },
    });
    expect(digest.data).toMatchObject({ tasks: [{ title: 'Late', dueDate: '2026-10-08' }, { title: 'Ship', dueDate: '2026-10-10' }] });
  });

  it('before the hour, the digest is yesterday’s — so a late hour still sends once a day', async () => {
    const { ctx } = await setup();
    await updateReminderPrefs(ctx, { reminderHour: 23, digestEnabled: true });

    // 06:00 UTC = 10:00 Yerevan on the 11th; 23:00 has not come yet today.
    const [digest] = await selectDueDigests(at('2026-10-11T06:00:00Z'));

    expect(digest.dedupeKey).toBe(`dig:${ctx.userId}:${ctx.workspaceId}:2026-10-10`);
    // Counts are as of now: the task due on the 10th is overdue on the 11th.
    expect(digest.data).toMatchObject({ dueToday: 0, overdue: 1 });
  });

  it('sends nothing when the digest is off or nothing is due', async () => {
    const { ctx, taskId } = await setup();
    const now = at('2026-10-10T05:00:00Z');

    await updateReminderPrefs(ctx, { reminderHour: 9, digestEnabled: false });
    expect(await selectDueDigests(now)).toEqual([]);

    await updateReminderPrefs(ctx, { reminderHour: 9, digestEnabled: true });
    await updateTask(ctx, { taskId, dueDate: '2026-10-11' });
    expect(await selectDueDigests(now)).toEqual([]);
  });

  it('caps the listed tasks at 20 but counts all of them', async () => {
    const { ctx, projectId } = await setup();
    for (let i = 0; i < 24; i++) {
      await createTask(ctx, { projectId, title: `T${i}`, dueDate: '2026-10-10', assigneeId: ctx.userId });
    }

    const [digest] = await selectDueDigests(at('2026-10-10T05:00:00Z'));

    expect(digest.data).toMatchObject({ dueToday: 25, overdue: 0 });
    expect((digest.data as { tasks: unknown[] }).tasks).toHaveLength(20);
  });
});

describe('claimNotifications', () => {
  it('inserts each key once, however often it runs', async () => {
    const { ctx, taskId } = await setup();
    await setTaskReminders(ctx, { taskId, offsets: [0] });
    const drafts = [
      ...(await selectDueReminders(at('2026-10-10T06:00:00Z'))),
      ...(await selectDueDigests(at('2026-10-10T06:00:00Z'))),
    ];

    expect(await claimNotifications(drafts)).toBe(2);
    expect(await claimNotifications(drafts)).toBe(0);
    expect(await db.select().from(notification)).toHaveLength(2);
  });

  it('does nothing for an empty list', async () => {
    expect(await claimNotifications([])).toBe(0);
  });
});
