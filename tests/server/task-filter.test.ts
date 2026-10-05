import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { task, workspaceSettings } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import type { TaskFilter } from '@/lib/task-filter';
import { createLabel, setTaskLabels } from '@/server/labels/service';
import { archiveProject, createProject } from '@/server/projects/service';
import { getProject } from '@/server/projects/queries';
import { listCalendarTasks } from '@/server/tasks/calendar';
import { compileTaskFilter, taskFilterSql } from '@/server/tasks/filter';
import { listProjectTasks, listWorkspaceTasks } from '@/server/tasks/queries';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

async function setup() {
  const ada = await createUser('ada-f@example.com', 'Ada');
  const bob = await createUser('bob-f@example.com', 'Bob');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-f');
  await joinWorkspace(bob.id, ws.id, 'member');
  const ctx: WorkspaceContext = { userId: ada.id, workspaceId: ws.id, slug: 'ws-f', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
  const bobCtx: WorkspaceContext = { ...ctx, userId: bob.id, role: 'member' };
  const p = await createProject(ctx, { name: 'Web' });
  if (!p.ok) throw new Error(p.error);
  const project = (await getProject(ctx, p.data.id))!;
  return { ctx, bobCtx, ada, bob, ws, projectId: p.data.id, statuses: project.statuses };
}

type Add = Parameters<typeof createTask>[1];
async function add(ctx: WorkspaceContext, input: Add) {
  const made = await createTask(ctx, input);
  if (!made.ok) throw new Error(made.error);
  return made.data.id;
}

const titles = async (ctx: WorkspaceContext, projectId: string, filter: TaskFilter) =>
  (await listProjectTasks(ctx, projectId, filter)).map((t) => t.title).sort();

describe('listProjectTasks with a filter', () => {
  it('no filter keeps today’s behaviour (done tasks included)', async () => {
    const { ctx, projectId, statuses } = await setup();
    await add(ctx, { projectId, title: 'Open' });
    await add(ctx, { projectId, title: 'Closed', statusId: statuses.find((s) => s.isDone)!.id });
    expect(await titles(ctx, projectId, {})).toEqual(['Closed', 'Open']);
  });

  it('state open / done', async () => {
    const { ctx, projectId, statuses } = await setup();
    await add(ctx, { projectId, title: 'Open' });
    await add(ctx, { projectId, title: 'Closed', statusId: statuses.find((s) => s.isDone)!.id });
    expect(await titles(ctx, projectId, { state: 'open' })).toEqual(['Open']);
    expect(await titles(ctx, projectId, { state: 'done' })).toEqual(['Closed']);
  });

  it('status is / not', async () => {
    const { ctx, projectId, statuses } = await setup();
    await add(ctx, { projectId, title: 'A', statusId: statuses[0].id });
    await add(ctx, { projectId, title: 'B', statusId: statuses[1].id });
    expect(await titles(ctx, projectId, { status: { op: 'is', ids: [statuses[0].id] } })).toEqual(['A']);
    expect(await titles(ctx, projectId, { status: { op: 'not', ids: [statuses[0].id] } })).toEqual(['B']);
  });

  it('priority is / not', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Hi', priority: 'high' });
    await add(ctx, { projectId, title: 'Lo', priority: 'low' });
    await add(ctx, { projectId, title: 'None' });
    expect(await titles(ctx, projectId, { priority: { op: 'is', values: ['high', 'low'] } })).toEqual(['Hi', 'Lo']);
    expect(await titles(ctx, projectId, { priority: { op: 'not', values: ['none'] } })).toEqual(['Hi', 'Lo']);
  });

  it('assignee me / none / user, and "not me" keeps unassigned', async () => {
    const { ctx, bob, projectId } = await setup();
    await add(ctx, { projectId, title: 'Mine', assigneeId: ctx.userId });
    await add(ctx, { projectId, title: 'Bob’s', assigneeId: bob.id });
    await add(ctx, { projectId, title: 'Nobody’s' });
    expect(await titles(ctx, projectId, { assignee: { op: 'is', ids: ['me'] } })).toEqual(['Mine']);
    expect(await titles(ctx, projectId, { assignee: { op: 'is', ids: ['none', bob.id] } })).toEqual(['Bob’s', 'Nobody’s']);
    expect(await titles(ctx, projectId, { assignee: { op: 'not', ids: ['me'] } })).toEqual(['Bob’s', 'Nobody’s']);
    expect(await titles(ctx, projectId, { assignee: { op: 'not', ids: ['none'] } })).toEqual(['Bob’s', 'Mine']);
    expect(await titles(ctx, projectId, { assignee: { op: 'not', ids: ['me', 'none'] } })).toEqual(['Bob’s']);
  });

  it('"me" means the caller', async () => {
    const { ctx, bobCtx, bob, projectId } = await setup();
    await add(ctx, { projectId, title: 'Mine', assigneeId: ctx.userId });
    await add(ctx, { projectId, title: 'Bob’s', assigneeId: bob.id });
    expect(await titles(bobCtx, projectId, { assignee: { op: 'is', ids: ['me'] } })).toEqual(['Bob’s']);
  });

  it('createdBy', async () => {
    const { ctx, bobCtx, projectId } = await setup();
    await add(ctx, { projectId, title: 'By Ada' });
    await add(bobCtx, { projectId, title: 'By Bob' });
    expect(await titles(ctx, projectId, { createdBy: { op: 'is', ids: ['me'] } })).toEqual(['By Ada']);
    expect(await titles(ctx, projectId, { createdBy: { op: 'not', ids: ['me'] } })).toEqual(['By Bob']);
  });

  it('labels any / none', async () => {
    const { ctx, projectId } = await setup();
    const bug = await createLabel(ctx, { name: 'bug' });
    const ui = await createLabel(ctx, { name: 'ui' });
    if (!bug.ok || !ui.ok) throw new Error();
    await add(ctx, { projectId, title: 'Bug', labelIds: [bug.data.id] });
    await add(ctx, { projectId, title: 'Both', labelIds: [bug.data.id, ui.data.id] });
    await add(ctx, { projectId, title: 'Plain' });
    expect(await titles(ctx, projectId, { labels: { op: 'any', ids: [ui.data.id, bug.data.id] } })).toEqual(['Both', 'Bug']);
    expect(await titles(ctx, projectId, { labels: { op: 'none', ids: [ui.data.id] } })).toEqual(['Bug', 'Plain']);
  });

  it('due range and none', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Oct 1', dueDate: '2026-10-01' });
    await add(ctx, { projectId, title: 'Oct 9', dueDate: '2026-10-09' });
    await add(ctx, { projectId, title: 'Undated' });
    expect(await titles(ctx, projectId, { due: { from: '2026-10-01', to: '2026-10-05' } })).toEqual(['Oct 1']);
    expect(await titles(ctx, projectId, { due: { from: '2026-10-05' } })).toEqual(['Oct 9']);
    expect(await titles(ctx, projectId, { due: { preset: 'none' } })).toEqual(['Undated']);
  });

  it('text matches title and description prefixes and odd tokens', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Deployment checklist' });
    await add(ctx, { projectId, title: 'Other', description: 'deploy the api' });
    await add(ctx, { projectId, title: 'Grow 50% faster' });
    expect(await titles(ctx, projectId, { q: 'deplo' })).toEqual(['Deployment checklist', 'Other']);
    expect(await titles(ctx, projectId, { q: '50%' })).toEqual(['Grow 50% faster']);
  });

  it('fields combine with AND', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Hit', priority: 'high', assigneeId: ctx.userId });
    await add(ctx, { projectId, title: 'Wrong person', priority: 'high' });
    await add(ctx, { projectId, title: 'Wrong priority', assigneeId: ctx.userId });
    expect(await titles(ctx, projectId, {
      priority: { op: 'is', values: ['high'] }, assignee: { op: 'is', ids: ['me'] },
    })).toEqual(['Hit']);
  });

  it('a stale id matches nothing and does not throw', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'A' });
    expect(await titles(ctx, projectId, { labels: { op: 'any', ids: ['gone'] } })).toEqual([]);
  });
});

describe('due presets in the caller’s zone', () => {
  // 2026-10-04T11:30Z is already Oct 5 in Kiritimati (UTC+14) and still Oct 4 in Pago Pago (UTC-11).
  const now = new Date('2026-10-04T11:30:00Z');

  async function dueTitles(ctx: WorkspaceContext, projectId: string, preset: 'overdue' | 'today' | 'this_week' | 'next_7d') {
    const where = await taskFilterSql(ctx, { due: { preset } }, 'project', now);
    // Only the filter predicates plus the project, to isolate the compiler.
    const rows = await db.select({ title: task.title }).from(task).where(and(eq(task.projectId, projectId), ...where));
    return rows.map((r) => r.title).sort();
  }

  it('today / overdue follow ctx.timezone', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Oct 4', dueDate: '2026-10-04' });
    await add(ctx, { projectId, title: 'Oct 5', dueDate: '2026-10-05' });
    const east = { ...ctx, timezone: 'Pacific/Kiritimati' };
    const west = { ...ctx, timezone: 'Pacific/Pago_Pago' };
    expect(await dueTitles(east, projectId, 'today')).toEqual(['Oct 5']);
    expect(await dueTitles(east, projectId, 'overdue')).toEqual(['Oct 4']);
    expect(await dueTitles(west, projectId, 'today')).toEqual(['Oct 4']);
    expect(await dueTitles(west, projectId, 'overdue')).toEqual([]);
  });

  it('next_7d is today through today + 6', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Oct 4', dueDate: '2026-10-04' });
    await add(ctx, { projectId, title: 'Oct 10', dueDate: '2026-10-10' });
    await add(ctx, { projectId, title: 'Oct 11', dueDate: '2026-10-11' });
    expect(await dueTitles(ctx, projectId, 'next_7d')).toEqual(['Oct 10', 'Oct 4']);
  });

  it('this_week follows the workspace week start', async () => {
    // 2026-10-04 is a Sunday.
    const { ctx, ws, projectId } = await setup();
    await add(ctx, { projectId, title: 'Sat Oct 3', dueDate: '2026-10-03' });
    await add(ctx, { projectId, title: 'Sun Oct 4', dueDate: '2026-10-04' });
    await add(ctx, { projectId, title: 'Mon Oct 5', dueDate: '2026-10-05' });
    await db.update(workspaceSettings).set({ weekStart: 1 }).where(eq(workspaceSettings.workspaceId, ws.id));
    expect(await dueTitles(ctx, projectId, 'this_week')).toEqual(['Sat Oct 3', 'Sun Oct 4']); // Mon Sep 28 – Sun Oct 4
    await db.update(workspaceSettings).set({ weekStart: 0 }).where(eq(workspaceSettings.workspaceId, ws.id));
    expect(await dueTitles(ctx, projectId, 'this_week')).toEqual(['Mon Oct 5', 'Sun Oct 4']); // Sun Oct 4 – Sat Oct 10
  });
});

describe('compileTaskFilter', () => {
  it('ignores status in workspace scope', async () => {
    const { ctx } = await setup();
    const sql = compileTaskFilter(ctx, { status: { op: 'is', ids: ['x'] } }, { scope: 'workspace', today: '2026-10-04', weekStart: 1 });
    expect(sql).toEqual([]);
  });
});

describe('listWorkspaceTasks', () => {
  it('spans active projects only, with project and status columns', async () => {
    const { ctx, projectId } = await setup();
    const other = await createProject(ctx, { name: 'App' });
    if (!other.ok) throw new Error();
    await add(ctx, { projectId, title: 'Web task' });
    await add(ctx, { projectId: other.data.id, title: 'App task' });
    let res = await listWorkspaceTasks(ctx, {});
    expect(res.tasks.map((t) => t.title).sort()).toEqual(['App task', 'Web task']);
    expect(res.tasks.find((t) => t.title === 'Web task')).toMatchObject({ projectName: 'Web', statusName: 'Todo', isDone: false });

    await archiveProject(ctx, { projectId: other.data.id });
    res = await listWorkspaceTasks(ctx, {});
    expect(res.tasks.map((t) => t.title)).toEqual(['Web task']);
  });

  it('never returns another workspace’s tasks, even when a filter names its ids', async () => {
    const { ctx, projectId } = await setup();
    const eve = await createUser('eve-f@example.com', 'Eve');
    const ws2 = await createWorkspace(eve.id, 'Other', 'ws-f2');
    const eveCtx: WorkspaceContext = { userId: eve.id, workspaceId: ws2.id, slug: 'ws-f2', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
    const p2 = await createProject(eveCtx, { name: 'Secret' });
    if (!p2.ok) throw new Error();
    await add(eveCtx, { projectId: p2.data.id, title: 'Secret task', assigneeId: eve.id });
    await add(ctx, { projectId, title: 'Mine' });
    const res = await listWorkspaceTasks(ctx, { assignee: { op: 'is', ids: [eve.id] } });
    expect(res.tasks).toEqual([]);
  });

  it('caps rows and reports truncation', async () => {
    const { ctx, projectId } = await setup();
    for (const t of ['A', 'B', 'C']) await add(ctx, { projectId, title: t });
    const res = await listWorkspaceTasks(ctx, {}, { limit: 2 });
    expect(res.tasks).toHaveLength(2);
    expect(res.truncated).toBe(true);
    expect((await listWorkspaceTasks(ctx, {}, { limit: 3 })).truncated).toBe(false);
  });

  it('sorts in SQL: due nulls last by default, priority by rank, title desc', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'b', dueDate: '2026-10-09', priority: 'low' });
    await add(ctx, { projectId, title: 'a', priority: 'urgent' });
    await add(ctx, { projectId, title: 'c', dueDate: '2026-10-01', priority: 'medium' });
    const order = async (sort: Parameters<typeof listWorkspaceTasks>[2]) =>
      (await listWorkspaceTasks(ctx, {}, sort)).tasks.map((t) => t.title);
    expect(await order({})).toEqual(['c', 'b', 'a']);
    expect(await order({ sort: { id: 'priority', desc: false } })).toEqual(['a', 'c', 'b']);
    expect(await order({ sort: { id: 'title', desc: true } })).toEqual(['c', 'b', 'a']);
    expect(await order({ sort: { id: 'due', desc: true } })).toEqual(['b', 'c', 'a']);
  });

  it('returns ids the API needs: status, assignee, parent, labels', async () => {
    const { ctx, projectId, statuses, bob } = await setup();
    const parent = await add(ctx, { projectId, title: 'Parent', assigneeId: bob.id });
    const made = await createLabel(ctx, { name: 'Bug' });
    if (!made.ok) throw new Error(made.error);
    await setTaskLabels(ctx, { taskId: parent, labelIds: [made.data.id] });

    const [row] = (await listWorkspaceTasks(ctx, {})).tasks;

    expect(row).toMatchObject({ id: parent, statusId: statuses[0].id, assigneeId: bob.id, parentTaskId: null, labelIds: [made.data.id] });
  });

  it('includes subtasks only when asked', async () => {
    const { ctx, projectId } = await setup();
    const parent = await add(ctx, { projectId, title: 'Parent' });
    await add(ctx, { projectId, title: 'Child', parentTaskId: parent });

    expect((await listWorkspaceTasks(ctx, {})).tasks.map((t) => t.title)).toEqual(['Parent']);
    const all = await listWorkspaceTasks(ctx, {}, { includeSubtasks: true });
    expect(all.tasks.find((t) => t.title === 'Child')?.parentTaskId).toBe(parent);
  });

  it('pages with offset in a stable order', async () => {
    const { ctx, projectId } = await setup();
    for (const t of ['A', 'B', 'C', 'D', 'E']) await add(ctx, { projectId, title: t });
    const sort = { id: 'title', desc: false } as const;

    const first = await listWorkspaceTasks(ctx, {}, { sort, limit: 2 });
    const third = await listWorkspaceTasks(ctx, {}, { sort, limit: 2, offset: 4 });

    expect(first.tasks.map((t) => t.title)).toEqual(['A', 'B']);
    expect(first.truncated).toBe(true);
    expect(third.tasks.map((t) => t.title)).toEqual(['E']);
    expect(third.truncated).toBe(false);
  });

  it('narrows to one project and then honours the status filter', async () => {
    const { ctx, projectId, statuses } = await setup();
    const other = await createProject(ctx, { name: 'App' });
    if (!other.ok) throw new Error();
    await add(ctx, { projectId, title: 'Todo one' });
    await add(ctx, { projectId, title: 'Doing one', statusId: statuses[1].id });
    await add(ctx, { projectId: other.data.id, title: 'Elsewhere' });

    const res = await listWorkspaceTasks(ctx, { status: { op: 'is', ids: [statuses[1].id] } }, { projectId });

    expect(res.tasks.map((t) => t.title)).toEqual(['Doing one']);
  });
});

describe('listCalendarTasks with a filter', () => {
  it('workspace scope spans projects and applies the filter', async () => {
    const { ctx, projectId } = await setup();
    const other = await createProject(ctx, { name: 'App' });
    if (!other.ok) throw new Error();
    await add(ctx, { projectId, title: 'Hi', dueDate: '2026-10-02', priority: 'high' });
    await add(ctx, { projectId: other.data.id, title: 'Hi 2', dueDate: '2026-10-03', priority: 'high' });
    await add(ctx, { projectId, title: 'Lo', dueDate: '2026-10-02', priority: 'low' });
    const rows = await listCalendarTasks(
      ctx, { from: '2026-09-28', to: '2026-11-08', workspace: true }, { priority: { op: 'is', values: ['high'] } },
    );
    expect(rows.map((r) => r.title)).toEqual(['Hi', 'Hi 2']);
  });
});
