import { ViewTabs } from '@/components/shell/ViewTabs';

// pl-16 on small screens reserves room for the fixed drawer trigger in Rail, so
// the title never sits underneath it. Below sm the title takes a row of its own and
// the tabs and actions wrap beneath it; beside them it would shrink to a letter.
export function ProjectHeader({
  name,
  basePath,
  children,
}: {
  name: string;
  basePath: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-stroke-soft-200 px-4 py-3 pl-16 lg:px-6 lg:pl-6">
      <h1 className="min-w-0 flex-1 truncate text-label-lg text-text-strong-950 max-sm:basis-full">{name}</h1>
      <ViewTabs basePath={basePath} />
      {children}
    </header>
  );
}
