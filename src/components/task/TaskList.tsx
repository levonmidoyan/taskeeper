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
        <div className="rounded-[var(--radius-card)] border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">No tasks yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Type below to add the first one.</p>
        </div>
      ) : (
        <ul className="rounded-[var(--radius-card)] border border-border bg-card">
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

      <div className="mt-2 rounded-[var(--radius-card)] border border-border bg-card px-3">
        <QuickAddTask workspaceSlug={workspaceSlug} projectId={projectId} />
      </div>
    </div>
  );
}
