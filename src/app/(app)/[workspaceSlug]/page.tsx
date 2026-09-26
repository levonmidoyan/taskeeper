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
      <h1 className="text-title-h5 text-text-strong-950">My tasks</h1>
      <p className="mt-1 text-paragraph-sm text-text-sub-600">
        Open work assigned to you across every project.
      </p>

      {tasks.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-stroke-sub-300 p-8 text-center">
          <p className="text-label-sm text-text-strong-950">Nothing assigned to you</p>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">
            Open a project from the sidebar to pick up work.
          </p>
        </div>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-2xl bg-bg-white-0 ring-1 ring-inset ring-stroke-soft-200">
          {tasks.map((task) => (
            <li key={task.id} className="border-b border-stroke-soft-200 last:border-b-0">
              <Link
                href={`/${workspaceSlug}/projects/${task.projectId}?task=${task.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-bg-weak-50"
              >
                <span className="min-w-0 flex-1 truncate text-paragraph-sm text-text-strong-950">
                  {task.title}
                </span>
                <span className="hidden shrink-0 text-paragraph-xs text-text-sub-600 sm:inline">
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
