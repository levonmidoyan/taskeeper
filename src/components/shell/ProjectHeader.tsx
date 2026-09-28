import { ViewTabs } from '@/components/shell/ViewTabs';

// Below sm the title takes a row of its own and the tabs and actions wrap beneath
// it; beside them it would shrink to a letter.
export function ProjectHeader({
  name,
  basePath,
  star,
  children,
}: {
  name: string;
  basePath: string;
  /** Sits right after the title, like Jira's star beside a board name. */
  star?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-stroke-soft-200 px-4 py-3 lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-1 max-sm:basis-full">
        <h1 className="min-w-0 truncate text-label-lg text-text-strong-950">{name}</h1>
        {star}
      </div>
      <ViewTabs basePath={basePath} />
      {children}
    </header>
  );
}
