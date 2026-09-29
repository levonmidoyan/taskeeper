import {
  IconAlertTriangle,
  IconCalendarDue,
  IconCircleCheck,
  IconCircleDashed,
} from '@tabler/icons-react';
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { StarButton } from '@/components/shell/StarButton';
import { PRIORITY_DOT, PRIORITY_LABEL, PriorityIcon } from '@/components/task/Priority';
import { statusBg } from '@/components/task/status-color';
import { StatusIcon } from '@/components/task/StatusIcon';
import { requireWorkspace } from '@/lib/session';
import { DUE_SOON_DAYS, summarizeTasks } from '@/lib/task-summary';
import { getProject } from '@/server/projects/queries';
import { listProjectTasks } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

export default async function ProjectSummaryPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);

  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const tasks = await listProjectTasks(ctx, projectId);
  const summary = summarizeTasks(tasks, project.statuses, ctx.timezone);
  const basePath = `/${workspaceSlug}/projects/${projectId}`;

  const tiles = [
    { label: 'Open', value: summary.open, icon: IconCircleDashed, tone: 'text-primary-base bg-primary-lighter' },
    { label: 'Done', value: summary.done, icon: IconCircleCheck, tone: 'text-success-base bg-success-lighter' },
    { label: 'Overdue', value: summary.overdue, icon: IconAlertTriangle, tone: 'text-error-base bg-error-lighter' },
    {
      label: `Due in ${DUE_SOON_DAYS} days`,
      value: summary.dueSoon,
      icon: IconCalendarDue,
      tone: 'text-warning-base bg-warning-lighter',
    },
  ];

  return (
    <main>
      <ProjectHeader
        name={project.name}
        basePath={basePath}
        star={<StarButton workspaceSlug={workspaceSlug} projectId={projectId} starred={project.starred} />}
      />
      <div className="mx-auto w-full max-w-400 px-4 py-6 lg:px-6">
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map(({ label, value, icon: Icon, tone }) => (
            <li
              key={label}
              className="flex items-center gap-3 rounded-2xl bg-bg-white-0 p-4 ring-1 ring-inset ring-stroke-soft-200"
            >
              <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', tone)}>
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="tabular text-title-h5 text-text-strong-950">{value}</p>
                <p className="truncate text-paragraph-xs text-text-sub-600">{label}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          <Breakdown
            title="By status"
            total={summary.total}
            rows={summary.byStatus.map(({ status, count }) => ({
              key: status.id, label: status.name, icon: <StatusIcon status={status} />, count,
              bar: statusBg(status.color),
            }))}
          />
          <Breakdown
            title="By priority"
            total={summary.total}
            rows={summary.byPriority.map(({ priority, count }) => ({
              key: priority, label: PRIORITY_LABEL[priority], icon: <PriorityIcon priority={priority} />, count,
              bar: PRIORITY_DOT[priority],
            }))}
          />
        </div>
      </div>
    </main>
  );
}

function Breakdown({
  title,
  total,
  rows,
}: {
  title: string;
  total: number;
  rows: { key: string; label: string; icon: React.ReactNode; count: number; bar: string }[];
}) {
  return (
    <section className="rounded-2xl bg-bg-white-0 p-4 ring-1 ring-inset ring-stroke-soft-200">
      <h2 className="text-label-md text-text-strong-950">{title}</h2>
      {total === 0 ? (
        <p className="mt-3 text-paragraph-sm text-text-sub-600">No tasks yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map(({ key, label, icon, count, bar }) => (
            <li key={key}>
              <div className="flex items-baseline justify-between gap-3 text-paragraph-sm">
                <span className="flex min-w-0 items-center gap-1.5 self-center text-text-strong-950">
                  {icon}
                  <span className="truncate">{label}</span>
                </span>
                <span className="tabular shrink-0 text-text-sub-600">{count}</span>
              </div>
              {/* Decorative: the count beside the label already says it. */}
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-weak-50" aria-hidden="true">
                <div className={cn('h-full rounded-full', bar)} style={{ width: `${(count / total) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
