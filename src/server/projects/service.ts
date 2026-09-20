import { and, eq } from 'drizzle-orm';
import { db, project, task, taskStatus } from '@/db';
import { newId } from '@/lib/ids';
import { positionsForCount } from '@/lib/position';
import { err, ForbiddenError, ok, type Result } from '@/lib/result';
import { requireRole, type WorkspaceContext } from '@/lib/session';
import { slugify } from '@/lib/slug';

const DEFAULT_STATUSES = [
  { name: 'Todo', color: 'muted', isDone: false },
  { name: 'In Progress', color: 'primary', isDone: false },
  { name: 'Done', color: 'success', isDone: true },
] as const;

// Same alphabet as the workspace slug uniquifier (src/server/workspaces/service.ts):
// slugify promises callers a slug matching ^[a-z0-9]+(-[a-z0-9]+)*$, and a raw
// nanoid slice could break that (nanoid's default alphabet includes '_' and '-').
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSuffix(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
  }
  return out;
}

// Project slugs are scoped per workspace, not global (unlike organization slugs,
// which are also route segments), so uniqueness is checked within workspaceId
// only and there is no reserved-word set to guard against.
async function uniqueProjectSlug(workspaceId: string, base: string): Promise<string> {
  const [taken] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), eq(project.slug, base)))
    .limit(1);
  return taken ? `${base}-${randomSuffix()}` : base;
}

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 64) return null;
  return trimmed;
}

export async function createProject(
  ctx: WorkspaceContext,
  input: { name: string; color?: string },
): Promise<Result<{ id: string }>> {
  const name = validateName(input.name);
  if (name === null) return err('Name your project, up to 64 characters.');

  const id = newId();
  const slug = await uniqueProjectSlug(ctx.workspaceId, slugify(name));
  const positions = positionsForCount(DEFAULT_STATUSES.length);

  await db.transaction(async (tx) => {
    await tx.insert(project).values({
      id, workspaceId: ctx.workspaceId, name, slug,
      color: input.color ?? 'primary', createdBy: ctx.userId,
    });
    await tx.insert(taskStatus).values(
      DEFAULT_STATUSES.map((s, i) => ({
        id: newId(), projectId: id, name: s.name, color: s.color,
        position: positions[i], isDone: s.isDone,
      })),
    );
  });

  return ok({ id });
}

export async function renameProject(
  ctx: WorkspaceContext,
  input: { projectId: string; name: string },
): Promise<Result<null>> {
  const name = validateName(input.name);
  if (name === null) return err('Name your project, up to 64 characters.');

  const updated = await db
    .update(project)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(project.id, input.projectId), eq(project.workspaceId, ctx.workspaceId)))
    .returning({ id: project.id });

  if (updated.length === 0) return err('Project not found.');

  return ok(null);
}

export async function archiveProject(
  ctx: WorkspaceContext,
  input: { projectId: string },
): Promise<Result<null>> {
  const updated = await db
    .update(project)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(project.id, input.projectId), eq(project.workspaceId, ctx.workspaceId)))
    .returning({ id: project.id });

  if (updated.length === 0) return err('Project not found.');

  return ok(null);
}

export async function deleteProject(
  ctx: WorkspaceContext,
  input: { projectId: string },
): Promise<Result<null>> {
  // requireRole throws rather than returning a Result: this is a plain
  // ctx-taking function, not wrapped in withAction (that wrapping happens once,
  // in actions.ts), so the ForbiddenError is converted to a Result right here.
  try {
    requireRole(ctx, 'owner', 'admin');
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    throw error;
  }

  const [owned] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, input.projectId), eq(project.workspaceId, ctx.workspaceId)))
    .limit(1);

  if (!owned) return err('Project not found.');

  // Explicit order. task.status_id is RESTRICT, and relying on cascade would
  // leave the delete order between task and task_status undefined (spec §3.2).
  await db.transaction(async (tx) => {
    await tx.delete(task).where(eq(task.projectId, input.projectId));
    await tx.delete(taskStatus).where(eq(taskStatus.projectId, input.projectId));
    await tx.delete(project).where(eq(project.id, input.projectId));
  });

  return ok(null);
}
