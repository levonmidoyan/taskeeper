import { IconStar } from '@tabler/icons-react';
import Link from 'next/link';
import { tintDot } from '@/components/brand/tint';
import { StarButton } from '@/components/shell/StarButton';
import { requireWorkspace } from '@/lib/session';
import { listProjects } from '@/server/projects/queries';
import { cn } from '@/utils/cn';

export default async function StarredPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const starred = (await listProjects(ctx)).filter((p) => p.starred);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-6">
      <h1 className="text-title-h5 text-text-strong-950">Starred</h1>
      <p className="mt-1 text-paragraph-sm text-text-sub-600">
        Projects you starred. They also stay pinned at the top of the sidebar.
      </p>

      {starred.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-20 border border-dashed border-stroke-sub-300 px-8 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-lighter text-primary-base ring-1 ring-inset ring-primary-alpha-16">
            <IconStar className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-4 text-label-sm text-text-strong-950">No starred projects</p>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">
            Open a project and use the star beside its name.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {starred.map((project) => (
            // The star sits beside the link, not inside it: a button nested in
            // an anchor is invalid and would navigate on every unstar.
            <li
              key={project.id}
              className="flex items-center gap-2 rounded-20 bg-bg-white-0 py-2 pr-2 pl-4 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200 transition-colors duration-150 hover:bg-bg-weak-50"
            >
              <Link
                href={`/${workspaceSlug}/projects/${project.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 py-2"
              >
                <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-[3px]', tintDot(project.id))} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label-sm text-text-strong-950">{project.name}</span>
                  <span className="tabular block text-paragraph-xs text-text-sub-600">
                    {project.openTaskCount === 0
                      ? 'No open tasks'
                      : `${project.openTaskCount} open ${project.openTaskCount === 1 ? 'task' : 'tasks'}`}
                  </span>
                </span>
              </Link>
              <StarButton workspaceSlug={workspaceSlug} projectId={project.id} starred />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
