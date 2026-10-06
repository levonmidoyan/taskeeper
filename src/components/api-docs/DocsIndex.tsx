import type { Endpoint, EndpointGroup } from '@/server/api/contract/types';
import { MethodBadge } from './EndpointSection';

function IndexList({ groups }: { groups: { group: EndpointGroup; endpoints: Endpoint[] }[] }) {
  return (
    <ul className="flex flex-col gap-4">
      <li><a href="#overview" className="text-label-sm text-text-strong-950 hover:underline">Overview</a></li>
      {groups.map(({ group, endpoints }) => (
        <li key={group} className="flex flex-col gap-1.5">
          <span className="text-label-xs uppercase text-text-soft-400">{group}</span>
          <ul className="flex flex-col gap-1">
            {endpoints.map((e) => (
              <li key={e.operationId}>
                <a href={`#${e.operationId}`} className="flex items-center gap-2 text-paragraph-sm text-text-sub-600 hover:text-text-strong-950">
                  <MethodBadge method={e.method} />
                  <span className="truncate">{e.summary}</span>
                </a>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Sticky side index on wide screens; a collapsible one on phones. No client JS: <details>. */
export function DocsIndex({ groups }: { groups: { group: EndpointGroup; endpoints: Endpoint[] }[] }) {
  return (
    <>
      <details className="rounded-2xl bg-bg-white-0 p-4 ring-1 ring-inset ring-stroke-soft-200 lg:hidden">
        <summary className="cursor-pointer text-label-sm text-text-strong-950">Endpoints</summary>
        <nav aria-label="API reference" className="mt-4"><IndexList groups={groups} /></nav>
      </details>
      <nav aria-label="API reference" className="hidden w-60 shrink-0 lg:sticky lg:top-6 lg:block">
        <IndexList groups={groups} />
      </nav>
    </>
  );
}
