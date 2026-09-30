'use client';

import { IconCircleCheck, IconSearch } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { projectDot } from '@/components/brand/tint';
import { ignoreShortcut } from '@/components/shell/shortcuts';
import * as Input from '@/components/ui/input';
import { settle } from '@/lib/settle';
import type { ProjectSummary } from '@/server/projects/queries';
import type { TaskSearchHit } from '@/server/tasks/queries';
import { searchTasksAction } from '@/server/tasks/actions';
import { cn } from '@/utils/cn';

type Hit =
  | { kind: 'project'; id: string; color: string; label: string; href: string }
  | { kind: 'task'; id: string; label: string; href: string; task: TaskSearchHit };

/**
 * Header search: project names match locally as you type, task titles come from
 * the server after a short pause. A combobox, so arrow keys walk the results and
 * Enter opens one; "/" focuses it from anywhere.
 */
export function TaskSearch({
  workspaceSlug,
  projects,
}: {
  workspaceSlug: string;
  projects: ProjectSummary[];
}) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  // Results remember the term they answer, so a slow response for an older
  // term never shows under a newer one, and "loading" is simply a mismatch.
  const [found, setFound] = useState<{ term: string; tasks: TaskSearchHit[] }>({ term: '', tasks: [] });
  const [active, setActive] = useState(0);

  const trimmed = term.trim();
  const searchable = trimmed.length >= 2;
  const tasks = searchable && found.term === trimmed ? found.tasks : [];
  const loading = searchable && found.term !== trimmed;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || ignoreShortcut(e)) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!searchable) return;
    const timer = setTimeout(async () => {
      const result = await settle(searchTasksAction(workspaceSlug, trimmed));
      setFound({ term: trimmed, tasks: result.ok ? result.data : [] });
    }, 200);
    return () => clearTimeout(timer);
  }, [searchable, trimmed, workspaceSlug]);

  const needle = trimmed.toLowerCase();
  const hits: Hit[] = !trimmed ? [] : [
    ...projects
      .filter((p) => p.name.toLowerCase().includes(needle))
      .slice(0, 3)
      .map((p): Hit => ({ kind: 'project', id: p.id, color: p.color, label: p.name, href: `/${workspaceSlug}/projects/${p.id}` })),
    ...tasks.map((t): Hit => ({
      kind: 'task',
      id: t.id,
      label: t.title,
      href: `/${workspaceSlug}/tasks/${t.id}`,
      task: t,
    })),
  ];

  // Hits can shrink under the highlight when task results arrive.
  const current = Math.min(active, Math.max(hits.length - 1, 0));

  function go(hit: Hit) {
    setOpen(false);
    setTerm('');
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      if (term) setTerm('');
      else inputRef.current?.blur();
      return;
    }
    if (!hits.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((current + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(hits[current]);
    }
  }

  const showPanel = open && trimmed.length > 0;
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <div className="relative w-full max-w-md">
      <Input.Root size="small">
        <Input.Wrapper>
          <Input.Icon as={IconSearch} />
          <Input.Input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label="Search tasks and projects"
            aria-expanded={showPanel}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showPanel && hits.length ? optionId(current) : undefined}
            placeholder="Search"
            autoComplete="off"
            value={term}
            maxLength={100}
            onChange={(e) => {
              setTerm(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            // 16px on phones stops iOS zooming the page when the field is focused.
            className="max-lg:text-paragraph-md [&::-webkit-search-cancel-button]:hidden"
          />
          <kbd className="hidden rounded border border-stroke-soft-200 px-1.5 text-label-xs text-text-soft-400 lg:inline">
            /
          </kbd>
        </Input.Wrapper>
      </Input.Root>

      {showPanel && (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          // Keeps focus in the input while a result is clicked, so blur does not
          // unmount the list before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[min(24rem,70dvh)] overflow-y-auto rounded-xl bg-bg-white-0 p-1.5 shadow-regular-md ring-1 ring-inset ring-stroke-soft-200 max-sm:fixed max-sm:inset-x-3 max-sm:top-14"
        >
          {hits.length === 0 ? (
            <p className="px-2.5 py-3 text-paragraph-sm text-text-sub-600">
              {!searchable ? 'Keep typing…' : loading ? 'Searching…' : 'No matches.'}
            </p>
          ) : (
            hits.map((hit, i) => (
              <div
                key={`${hit.kind}-${hit.id}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === current}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(hit)}
                className={cn(
                  'flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-label-sm text-text-strong-950',
                  i === current && 'bg-bg-weak-50',
                )}
              >
                {hit.kind === 'project' ? (
                  <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-[3px]', projectDot(hit))} />
                ) : (
                  <IconCircleCheck
                    aria-hidden="true"
                    className={cn('size-4 shrink-0', hit.task.completed ? 'text-success-base' : 'text-text-soft-400')}
                  />
                )}
                <span className={cn('truncate', hit.kind === 'task' && hit.task.completed && 'text-text-sub-600 line-through')}>
                  {hit.label}
                </span>
                <span className="ml-auto shrink-0 truncate text-paragraph-xs text-text-soft-400">
                  {hit.kind === 'project' ? 'Project' : hit.task.projectName}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
