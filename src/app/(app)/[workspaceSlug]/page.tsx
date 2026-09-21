import Link from 'next/link';
import { DueChip } from '@/components/task/DueChip';
import { PriorityDot } from '@/components/task/PriorityDot';
import { requireWorkspace } from '@/lib/session';
import { listMyOpenTasks } from '@/server/tasks/queries';

export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const tasks = await listMyOpenTasks(ctx);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pl-16 lg:px-6 lg:pl-6">
      <h1 className="text-2xl font-semibold text-foreground">My tasks</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Open work assigned to you across every project.
      </p>

      {tasks.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">Nothing assigned to you</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a project from the sidebar to pick up work.
          </p>
        </div>
      ) : (
        <ul className="mt-6 rounded-[var(--radius-card)] border border-border bg-card">
          {tasks.map((task) => (
            <li key={task.id} className="border-b border-border last:border-b-0">
              <Link
                href={`/${workspaceSlug}/projects/${task.projectId}?task=${task.id}`}
                className="flex items-center gap-3 px-3 py-3 transition-colors duration-150 hover:bg-muted/60"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {task.title}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {task.projectName}
                </span>
                <PriorityDot priority={task.priority} />
                <DueChip dueDate={task.dueDate} timezone={ctx.timezone} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
