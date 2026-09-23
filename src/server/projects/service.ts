import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, project, task, taskStatus } from '@/db';
import { newId } from '@/lib/ids';
import { positionsForCount } from '@/lib/position';
import { err, ok, type Result } from '@/lib/result';
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

// Restored to a zod parse (the brief's original approach) rather than a
// hand-rolled check: `input` reaches this function from a public HTTP
// endpoint (actions.ts), unvalidated in shape or type. A hand-rolled
// `name.trim()` throws a TypeError on a missing/non-string `name` — which
// withAction then reports as a generic "Something went wrong" instead of a
// helpful message — and a wrong-typed `projectId`/`color` would go straight
// into drizzle. zod rejects all of that with a clear message before anything
// unsafe happens.
const nameSchema = z
  .string().trim().min(1, 'Name your project.').max(64, 'Keep it under 64 characters.');

export async function createProject(
  ctx: WorkspaceContext,
  input: { name: string; color?: string },
): Promise<Result<{ id: string }>> {
  const parsed = z.object({ name: nameSchema, color: z.string().optional() }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0].message);

  const id = newId();
  const slug = await uniqueProjectSlug(ctx.workspaceId, slugify(parsed.data.name));
  const positions = positionsForCount(DEFAULT_STATUSES.length);

  await db.transaction(async (tx) => {
    await tx.insert(project).values({
      id, workspaceId: ctx.workspaceId, name: parsed.data.name, slug,
      color: parsed.data.color ?? 'primary', createdBy: ctx.userId,
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
  const parsed = z.object({ projectId: z.string(), name: nameSchema }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0].message);

  const updated = await db
    .update(project)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(and(eq(project.id, parsed.data.projectId), eq(project.workspaceId, ctx.workspaceId)))
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
  // Services throw, actions convert (controller ruling). withAction, in
  // actions.ts, already converts a ForbiddenError with the identical
  // err(error.message) — catching it here too would just give the same
  // failure two different shapes depending on which layer is asked.
  requireRole(ctx, 'owner', 'admin');

  return db.transaction(async (tx) => {
    // The ownership check and the deletes must run in the same transaction:
    // outside it, this is check-then-act — a race that a concurrent change
    // could slip through between the SELECT and the DELETEs.
    const [owned] = await tx
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, input.projectId), eq(project.workspaceId, ctx.workspaceId)))
      .limit(1);

    if (!owned) return err('Project not found.');

    // Explicit order, every delete scoped to this workspace. task.status_id is
    // RESTRICT, and relying on cascade would leave the delete order between
    // task and task_status undefined (spec §3.2). task_status has no
    // workspace_id column of its own, so its scope comes from the project row
    // just verified above.
    await tx.delete(task).where(
      and(eq(task.projectId, input.projectId), eq(task.workspaceId, ctx.workspaceId)),
    );
    await tx.delete(taskStatus).where(eq(taskStatus.projectId, input.projectId));
    await tx.delete(project).where(
      and(eq(project.id, input.projectId), eq(project.workspaceId, ctx.workspaceId)),
    );

    return ok(null);
  });
}
