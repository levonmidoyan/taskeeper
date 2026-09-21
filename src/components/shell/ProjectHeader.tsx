import { ViewTabs } from '@/components/shell/ViewTabs';

// pl-16 on small screens reserves room for the fixed drawer trigger in Rail, so
// the title never sits underneath it.
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
    <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 pl-16 lg:px-6 lg:pl-6">
      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">{name}</h1>
      <ViewTabs basePath={basePath} />
      {children}
    </header>
  );
}
