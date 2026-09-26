import { QuickAddTask } from '@/components/task/QuickAddTask';
import { TaskRow } from '@/components/task/TaskRow';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow as TaskRowData } from '@/server/tasks/queries';

export function TaskList({
  tasks,
  statuses,
  workspaceSlug,
  projectId,
  timezone,
}: {
  tasks: TaskRowData[];
  statuses: StatusRow[];
  workspaceSlug: string;
  projectId: string;
  timezone: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6">
      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stroke-sub-300 p-8 text-center">
          <p className="text-label-sm text-text-strong-950">No tasks yet</p>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">Type below to add the first one.</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-bg-white-0 ring-1 ring-inset ring-stroke-soft-200">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              statuses={statuses}
              workspaceSlug={workspaceSlug}
              timezone={timezone}
            />
          ))}
        </ul>
      )}

      <div className="mt-2 rounded-2xl bg-bg-white-0 px-3 ring-1 ring-inset ring-stroke-soft-200">
        <QuickAddTask workspaceSlug={workspaceSlug} projectId={projectId} />
      </div>
    </div>
  );
}
