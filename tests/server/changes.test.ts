import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { uploadTo } from '../setup/storage';
import { cancelUpload, confirmUpload, deleteAttachment, requestUpload } from '@/server/attachments/service';
import { createComment, deleteComment, updateComment } from '@/server/comments/service';
import { createLabel, deleteLabel, setTaskLabels } from '@/server/labels/service';
import { notification } from '@/db';
import { newId } from '@/lib/ids';
import { markAllRead, markRead } from '@/server/notifications/service';
import { setTaskReminders } from '@/server/reminders/service';
import { createTodo, deleteTodo, moveTodo, updateTodo } from '@/server/todos/service';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import type { WorkspaceContext } from '@/lib/session';
import { getWorkspaceVersion, pollWorkspaceVersion } from '@/server/changes/queries';
import { emitChange, emitChangeFor } from '@/server/changes/service';
import {
  acceptInvitation, changeMemberRole, declineInvitation, inviteMember, removeMember,
} from '@/server/members/service';
import { updateWorkspaceSettings } from '@/server/settings/service';
import { createView, deleteView, duplicateView, updateView } from '@/server/views/service';
import { PROJECT_COLOR_KEYS } from '@/components/brand/tint';
import type { Result } from '@/lib/result';
import { getProject } from '@/server/projects/queries';
import {
  archiveProject, createProject, deleteProject, renameProject, setProjectColor, setProjectStar, unarchiveProject,
} from '@/server/projects/service';
import { createStatus, deleteStatus, moveStatus, updateStatus } from '@/server/statuses/service';
import {
  bulkDeleteTasks, bulkUpdateTasks, createTask, deleteTask, moveTask, updateTask,
} from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(slug = 'acme') {
  const ada = await createUser(`${slug}@example.com`, 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: ada.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC',
  };
  return { ctx, ws, ada };
}

/** How far one call moved the counter. Also asserts whether the call succeeded. */
async function delta(ctx: WorkspaceContext, run: () => Promise<Result<unknown>>, expectOk = true): Promise<number> {
  const before = await getWorkspaceVersion(ctx);
  const result = await run();
  expect(result.ok, result.ok ? undefined : result.error).toBe(expectOk);
  return (await getWorkspaceVersion(ctx)) - before;
}

/** A workspace with one project (Todo / In Progress / Done) and one task in Todo. */
async function seeded(slug = 'acme') {
  const base = await setup(slug);
  const project = await createProject(base.ctx, { name: 'Website' });
  if (!project.ok) throw new Error(project.error);
  const statuses = (await getProject(base.ctx, project.data.id))!.statuses;
  const made = await createTask(base.ctx, { projectId: project.data.id, title: 'Ship' });
  if (!made.ok) throw new Error(made.error);
  return { ...base, projectId: project.data.id, statuses, taskId: made.data.id };
}

describe('workspace change counter', () => {
  it('reads 0 before anything changed', async () => {
    const { ctx } = await setup();
    expect(await getWorkspaceVersion(ctx)).toBe(0);
  });

  it('goes up by one per emit, with or without a context', async () => {
    const { ctx } = await setup();
    await emitChange(ctx, {}, db);
    await emitChangeFor(ctx.workspaceId, db);
    expect(await getWorkspaceVersion(ctx)).toBe(2);
  });

  it('rolls back with the transaction it ran in', async () => {
    const { ctx } = await setup();
    await db
      .transaction(async (tx) => {
        await emitChange(ctx, { projectId: null }, tx);
        tx.rollback();
      })
      .catch(() => undefined);
    expect(await getWorkspaceVersion(ctx)).toBe(0);
  });

  it('keeps workspaces apart', async () => {
    const a = await setup('acme');
    const b = await setup('globex');
    await emitChange(a.ctx, {}, db);
    expect(await getWorkspaceVersion(b.ctx)).toBe(0);
  });
});

describe('pollWorkspaceVersion', () => {
  it('answers a member with the version', async () => {
    const { ctx, ada } = await setup();
    await emitChange(ctx, {}, db);
    expect(await pollWorkspaceVersion(ada.id, 'acme')).toBe(1);
  });

  it('answers 0 for a workspace that never changed', async () => {
    const { ada } = await setup();
    expect(await pollWorkspaceVersion(ada.id, 'acme')).toBe(0);
  });

  it('answers null to a non-member and for an unknown slug alike', async () => {
    await setup('acme');
    const { ada: outsider } = await setup('globex');
    expect(await pollWorkspaceVersion(outsider.id, 'acme')).toBeNull();
    expect(await pollWorkspaceVersion(outsider.id, 'nope')).toBeNull();
  });
});

describe('task writes bump the counter', () => {
  it('createTask', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => createTask(ctx, { projectId, title: 'More' }))).toBe(1);
  });

  it('a refused create does not', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => createTask(ctx, { projectId, title: '   ' }), false)).toBe(0);
  });

  it('updateTask', async () => {
    const { ctx, taskId } = await seeded();
    expect(await delta(ctx, () => updateTask(ctx, { taskId, title: 'Renamed' }))).toBe(1);
  });

  it('moveTask', async () => {
    const { ctx, taskId, statuses } = await seeded();
    expect(await delta(ctx, () => moveTask(ctx, { taskId, statusId: statuses[1].id, beforeId: null, afterId: null }))).toBe(1);
  });

  it('deleteTask', async () => {
    const { ctx, taskId } = await seeded();
    expect(await delta(ctx, () => deleteTask(ctx, { taskId }))).toBe(1);
  });

  it('bulkUpdateTasks bumps once for the whole set', async () => {
    const { ctx, projectId, taskId } = await seeded();
    const other = await createTask(ctx, { projectId, title: 'Other' });
    if (!other.ok) throw new Error(other.error);
    expect(await delta(ctx, () => bulkUpdateTasks(ctx, { taskIds: [taskId, other.data.id], patch: { priority: 'high' } }))).toBe(1);
  });

  it('bulkDeleteTasks', async () => {
    const { ctx, taskId } = await seeded();
    expect(await delta(ctx, () => bulkDeleteTasks(ctx, { taskIds: [taskId] }))).toBe(1);
  });
});

describe('column writes bump the counter', () => {
  it('createStatus', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => createStatus(ctx, { projectId, name: 'Review' }))).toBe(1);
  });

  it('updateStatus, but not an empty update', async () => {
    const { ctx, statuses } = await seeded();
    expect(await delta(ctx, () => updateStatus(ctx, { statusId: statuses[0].id, name: 'Backlog' }))).toBe(1);
    expect(await delta(ctx, () => updateStatus(ctx, { statusId: statuses[0].id }))).toBe(0);
  });

  it('moveStatus', async () => {
    const { ctx, statuses } = await seeded();
    expect(await delta(ctx, () => moveStatus(ctx, { statusId: statuses[0].id, beforeId: statuses[2].id, afterId: null }))).toBe(1);
  });

  it('deleteStatus', async () => {
    const { ctx, statuses } = await seeded();
    // In Progress is empty; the seeded task sits in Todo.
    expect(await delta(ctx, () => deleteStatus(ctx, { statusId: statuses[1].id }))).toBe(1);
  });

  it('a refused delete rolls back and does not bump', async () => {
    const { ctx, statuses } = await seeded();
    // Todo holds a task and no target is named.
    expect(await delta(ctx, () => deleteStatus(ctx, { statusId: statuses[0].id }), false)).toBe(0);
  });
});

describe('project writes bump the counter', () => {
  it('createProject', async () => {
    const { ctx } = await setup();
    expect(await delta(ctx, () => createProject(ctx, { name: 'Docs' }))).toBe(1);
  });

  it('rename, color, archive, unarchive, delete', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => renameProject(ctx, { projectId, name: 'Site' }))).toBe(1);
    expect(await delta(ctx, () => setProjectColor(ctx, { projectId, color: PROJECT_COLOR_KEYS[1] }))).toBe(1);
    expect(await delta(ctx, () => archiveProject(ctx, { projectId }))).toBe(1);
    expect(await delta(ctx, () => unarchiveProject(ctx, { projectId }))).toBe(1);
    expect(await delta(ctx, () => deleteProject(ctx, { projectId }))).toBe(1);
  });

  it('a rename of an unknown project does not', async () => {
    const { ctx } = await setup();
    expect(await delta(ctx, () => renameProject(ctx, { projectId: 'nope', name: 'X' }), false)).toBe(0);
  });

  it('starring is private and does not', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => setProjectStar(ctx, { projectId, starred: true }))).toBe(0);
  });
});

describe('comment writes bump the counter', () => {
  it('create, edit, delete', async () => {
    const { ctx, taskId } = await seeded();
    let commentId = '';
    expect(await delta(ctx, async () => {
      const r = await createComment(ctx, { taskId, body: 'Hi' });
      if (r.ok) commentId = r.data.id;
      return r;
    })).toBe(1);
    expect(await delta(ctx, () => updateComment(ctx, { commentId, body: 'Hello' }))).toBe(1);
    expect(await delta(ctx, () => deleteComment(ctx, { commentId }))).toBe(1);
  });
});

describe('attachment writes', () => {
  async function requested(ctx: WorkspaceContext, taskId: string) {
    const body = new TextEncoder().encode('hello');
    const req = await requestUpload(ctx, { taskId, fileName: 'a.txt', contentType: 'text/plain', size: body.length });
    if (!req.ok) throw new Error(req.error);
    await uploadTo(req.data.url, body, req.data.contentType);
    return req.data.id;
  }

  it('an unconfirmed upload is invisible to others and does not bump', async () => {
    const { ctx, taskId } = await seeded();
    const before = await getWorkspaceVersion(ctx);
    const attachmentId = await requested(ctx, taskId);
    expect(await delta(ctx, () => cancelUpload(ctx, { attachmentId }))).toBe(0);
    expect(await getWorkspaceVersion(ctx)).toBe(before);
  });

  it('confirm and delete do', async () => {
    const { ctx, taskId } = await seeded();
    const attachmentId = await requested(ctx, taskId);
    expect(await delta(ctx, () => confirmUpload(ctx, { attachmentId }))).toBe(1);
    expect(await delta(ctx, () => deleteAttachment(ctx, { attachmentId }))).toBe(1);
  });
});

describe('label writes', () => {
  it('create bumps; asking for an existing name does not', async () => {
    const { ctx } = await seeded();
    expect(await delta(ctx, () => createLabel(ctx, { name: 'Bug' }))).toBe(1);
    expect(await delta(ctx, () => createLabel(ctx, { name: 'Bug' }))).toBe(0);
  });

  it('setTaskLabels and deleteLabel bump', async () => {
    const { ctx, taskId } = await seeded();
    const made = await createLabel(ctx, { name: 'Bug' });
    if (!made.ok) throw new Error(made.error);
    expect(await delta(ctx, () => setTaskLabels(ctx, { taskId, labelIds: [made.data.id] }))).toBe(1);
    expect(await delta(ctx, () => deleteLabel(ctx, { labelId: made.data.id }))).toBe(1);
  });
});

describe('member writes bump the counter', () => {
  it('invite, then accept by the invitee', async () => {
    const { ctx } = await setup();
    const bob = await createUser('bob@example.com', 'Bob');
    let invitationId = '';
    expect(await delta(ctx, async () => {
      const r = await inviteMember(ctx, { email: bob.email, role: 'member' });
      if (r.ok) invitationId = r.data.invitationId;
      return r;
    })).toBe(1);
    expect(await delta(ctx, () => acceptInvitation(bob.id, bob.email, invitationId))).toBe(1);
  });

  it('decline by the invitee', async () => {
    const { ctx } = await setup();
    const invited = await inviteMember(ctx, { email: 'bob@example.com', role: 'member' });
    if (!invited.ok) throw new Error(invited.error);
    expect(await delta(ctx, () => declineInvitation('bob@example.com', invited.data.invitationId))).toBe(1);
  });

  it('role change and removal', async () => {
    const { ctx, ws } = await setup();
    const bob = await createUser('bob@example.com', 'Bob');
    await joinWorkspace(bob.id, ws.id, 'member');
    expect(await delta(ctx, () => changeMemberRole(ctx, { userId: bob.id, role: 'admin' }))).toBe(1);
    expect(await delta(ctx, () => removeMember(ctx, { userId: bob.id }))).toBe(1);
  });
});

describe('workspace settings', () => {
  it('a change bumps; an empty one does not', async () => {
    const { ctx } = await setup();
    expect(await delta(ctx, () => updateWorkspaceSettings(ctx, { weekStart: 1 }))).toBe(1);
    expect(await delta(ctx, () => updateWorkspaceSettings(ctx, {}))).toBe(0);
  });
});

describe('saved views: only shared ones bump', () => {
  const view = { projectId: null, layout: 'list' as const, filter: {} };

  it('a private view is invisible to others', async () => {
    const { ctx } = await setup();
    let id = '';
    expect(await delta(ctx, async () => {
      const r = await createView(ctx, { ...view, name: 'Mine' });
      if (r.ok) id = r.data.id;
      return r;
    })).toBe(0);
    expect(await delta(ctx, () => updateView(ctx, { id, name: 'Still mine' }))).toBe(0);
    expect(await delta(ctx, () => deleteView(ctx, { id }))).toBe(0);
  });

  it('sharing, editing a shared view and deleting it bump', async () => {
    const { ctx } = await setup();
    const made = await createView(ctx, { ...view, name: 'Team' });
    if (!made.ok) throw new Error(made.error);
    const id = made.data.id;
    expect(await delta(ctx, () => updateView(ctx, { id, shared: true }))).toBe(1);
    expect(await delta(ctx, () => updateView(ctx, { id, name: 'Team board' }))).toBe(1);
    expect(await delta(ctx, () => updateView(ctx, { id, shared: false }))).toBe(1);
    expect(await delta(ctx, () => updateView(ctx, { id, shared: true }))).toBe(1);
    expect(await delta(ctx, () => deleteView(ctx, { id }))).toBe(1);
  });

  it('creating a shared view bumps; duplicating one makes a private copy that does not', async () => {
    const { ctx } = await setup();
    let id = '';
    expect(await delta(ctx, async () => {
      const r = await createView(ctx, { ...view, name: 'Team', shared: true });
      if (r.ok) id = r.data.id;
      return r;
    })).toBe(1);
    expect(await delta(ctx, () => duplicateView(ctx, { id }))).toBe(0);
  });
});

describe('private writes do not bump', () => {
  it('to-dos: create, edit, check, move, delete', async () => {
    const { ctx } = await setup();
    const ids: string[] = [];
    for (const title of ['One', 'Two']) {
      expect(await delta(ctx, async () => {
        const r = await createTodo(ctx, { title });
        if (r.ok) ids.push(r.data.id);
        return r;
      })).toBe(0);
    }
    expect(await delta(ctx, () => updateTodo(ctx, { todoId: ids[0], title: 'One!' }))).toBe(0);
    expect(await delta(ctx, () => moveTodo(ctx, { todoId: ids[1], beforeId: null, afterId: ids[0] }))).toBe(0);
    expect(await delta(ctx, () => updateTodo(ctx, { todoId: ids[0], done: true }))).toBe(0);
    expect(await delta(ctx, () => deleteTodo(ctx, { todoId: ids[0] }))).toBe(0);
  });

  it('my reminders on a task', async () => {
    const { ctx, taskId } = await seeded();
    expect(await delta(ctx, () => setTaskReminders(ctx, { taskId, offsets: [0, 1] }))).toBe(0);
    expect(await delta(ctx, () => setTaskReminders(ctx, { taskId, offsets: [] }))).toBe(0);
  });

  it('marking notifications read, one or all', async () => {
    const { ctx } = await setup();
    const ids = [newId(), newId()];
    await db.insert(notification).values(ids.map((id) => ({
      id, userId: ctx.userId, workspaceId: ctx.workspaceId, kind: 'digest' as const, dedupeKey: id,
      data: { localDate: '2026-10-10', dueToday: 1, overdue: 0, tasks: [] },
    })));
    expect(await delta(ctx, () => markRead(ctx, ids[0]))).toBe(0);
    expect(await delta(ctx, () => markAllRead(ctx))).toBe(0);
  });
});
