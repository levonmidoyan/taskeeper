'use client';

import {
  IconArrowDown, IconArrowRight, IconArrowUp, IconCircleCheck, IconCornerDownLeft, IconPlus, IconSearch,
} from '@tabler/icons-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { projectDot } from '@/components/brand/tint';
import { matchActions, paletteActions, type PaletteAction } from '@/components/shell/palette-actions';
import { ignoreShortcut, OVERLAY_SELECTOR } from '@/components/shell/shortcuts';
import * as CommandMenu from '@/components/ui/command-menu';
import { splitHighlights } from '@/lib/highlights';
import { settle } from '@/lib/settle';
import type { ProjectSummary } from '@/server/projects/queries';
import type { RecentTask, TaskSearchHit } from '@/server/tasks/queries';
import { recentTasksAction, searchTasksAction } from '@/server/tasks/actions';
import { cn } from '@/utils/cn';

const noSubscribe = () => () => {};

type TaskLike = Pick<TaskSearchHit, 'id' | 'title' | 'projectName' | 'completed'> & { snippet?: string | null };

/**
 * ⌘K / Ctrl+K, "/" or the header button. Empty, it offers recent tasks and
 * actions; typed into, projects match locally, tasks come from full-text search
 * after a short pause, and actions filter by label. Built on Align's Command
 * Menu; this file only decides what to list and when.
 */
export function CommandPalette({
  workspaceSlug,
  projects,
  onNewTask,
}: {
  workspaceSlug: string;
  projects: ProjectSummary[];
  onNewTask: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [recent, setRecent] = useState<RecentTask[]>([]);
  // Results remember the term they answer, so a slow response for an older
  // term never shows under a newer one, and "loading" is simply a mismatch.
  const [found, setFound] = useState<{ term: string; tasks: TaskSearchHit[] }>({ term: '', tasks: [] });
  // Set when "New task" is picked; the create dialog opens once this one has
  // finished closing, so focus lands in it rather than on <body>.
  const pendingNewTask = useRef(false);
  // The platform never changes; false on the server so the first paint matches.
  const isMac = useSyncExternalStore(noSubscribe, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false);

  const trimmed = term.trim();
  const searchable = trimmed.length >= 2;
  const tasks = searchable && found.term === trimmed ? found.tasks : [];
  const loading = searchable && found.term !== trimmed;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const modK = e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
      if (modK) {
        // Another dialog, menu or dropdown owns the screen; leave it alone.
        if (!open && document.querySelector(OVERLAY_SELECTOR)) return;
        e.preventDefault();
        onOpenChange(!open);
        return;
      }
      if (e.key === '/' && !open && !ignoreShortcut(e)) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!open) return;
    let live = true;
    settle(recentTasksAction(workspaceSlug)).then((r) => {
      if (live) setRecent(r.ok ? r.data : []);
    });
    return () => { live = false; };
  }, [open, workspaceSlug]);

  useEffect(() => {
    if (!searchable) return;
    // Dropped once the term moves on, so a late answer for an older term can
    // never replace the newer one and leave the palette "Searching…".
    let live = true;
    const timer = setTimeout(async () => {
      const result = await settle(searchTasksAction(workspaceSlug, trimmed));
      if (live) setFound({ term: trimmed, tasks: result.ok ? result.data : [] });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [searchable, trimmed, workspaceSlug]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) return;
    // Start the next open fresh rather than showing this session's results.
    setTerm('');
    setRecent([]);
    setFound({ term: '', tasks: [] });
  }

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  function run(action: PaletteAction) {
    if (action.command === 'new-task') {
      pendingNewTask.current = true;
      onOpenChange(false);
    } else if (action.href) {
      go(action.href);
    }
  }

  const projectName = projects.find((p) => pathname.includes(`/projects/${p.id}`))?.name;
  // Without a project there is nowhere to create a task, so "New task" is not offered.
  const actions = matchActions(paletteActions(workspaceSlug, pathname, projectName), trimmed)
    .filter((a) => a.command !== 'new-task' || projects.length > 0);
  const needle = trimmed.toLowerCase();
  const projectHits = trimmed ? projects.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 3) : [];
  const taskRows: TaskLike[] = trimmed ? tasks : recent;
  const nothing = !projectHits.length && !taskRows.length && !actions.length;

  return (
    <>
      <button
        type="button"
        aria-label="Search"
        aria-keyshortcuts={isMac ? 'Meta+K /' : 'Control+K /'}
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-10 bg-bg-white-0 px-2.5 text-paragraph-sm text-text-soft-400 ring-1 ring-inset ring-stroke-soft-200 transition hover:bg-bg-weak-50 max-sm:w-9 max-sm:justify-center max-sm:px-0"
      >
        <IconSearch aria-hidden="true" className="size-5 shrink-0" />
        <span className="flex-1 text-left max-sm:sr-only">Search…</span>
        <kbd className="hidden rounded border border-stroke-soft-200 px-1.5 text-label-xs lg:inline">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

      <CommandMenu.Dialog
        open={open}
        onOpenChange={onOpenChange}
        // Full screen on phones, like the other dialogs.
        overlayClassName="max-sm:p-0 max-sm:pt-0"
        className="max-sm:h-dvh max-sm:max-w-none max-sm:rounded-none"
        commandProps={{ label: 'Search', shouldFilter: false, loop: true }}
        contentProps={{
          'aria-describedby': undefined,
          onCloseAutoFocus: (e) => {
            if (!pendingNewTask.current) return;
            pendingNewTask.current = false;
            e.preventDefault();
            onNewTask();
          },
        }}
      >
        <CommandMenu.DialogTitle className="sr-only">Search</CommandMenu.DialogTitle>
        <div className="group/cmd-input flex h-12 items-center gap-2 px-5">
          <IconSearch aria-hidden="true" className="size-5 shrink-0 text-text-sub-600" />
          <CommandMenu.Input
            value={term}
            onValueChange={setTerm}
            maxLength={100}
            placeholder="Search tasks, projects and actions"
            // 16px on phones stops iOS zooming the page when the field is focused.
            className="h-12 max-lg:text-paragraph-md"
          />
        </div>
        {/* Outside the listbox, and always mounted, so screen readers announce each change. */}
        <div role="status" className="text-paragraph-sm text-text-sub-600 empty:border-0">
          {trimmed && (!searchable || loading || nothing) && (
            <p className="px-5 py-4">{!searchable ? 'Keep typing…' : loading ? 'Searching…' : 'No matches.'}</p>
          )}
        </div>
        <CommandMenu.List className="max-h-[min(26rem,70dvh)] max-sm:max-h-none">
          {projectHits.length > 0 && (
            <CommandMenu.Group heading="Projects">
              {projectHits.map((p) => (
                <CommandMenu.Item
                  key={`project-${p.id}`}
                  value={`project-${p.id}`}
                  onSelect={() => go(`/${workspaceSlug}/projects/${p.id}`)}
                >
                  <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-[3px]', projectDot(p))} />
                  <span className="truncate">{p.name}</span>
                </CommandMenu.Item>
              ))}
            </CommandMenu.Group>
          )}
          {taskRows.length > 0 && (
            <CommandMenu.Group heading={trimmed ? 'Tasks' : 'Recent'}>
              {taskRows.map((t) => (
                <CommandMenu.Item
                  key={`task-${t.id}`}
                  value={`task-${t.id}`}
                  onSelect={() => go(`/${workspaceSlug}/tasks/${t.id}`)}
                >
                  <CommandMenu.ItemIcon
                    as={IconCircleCheck}
                    aria-hidden="true"
                    className={cn('self-start', t.completed ? 'text-success-base' : 'text-text-soft-400')}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn('truncate', t.completed && 'text-text-sub-600 line-through')}>{t.title}</span>
                    {t.snippet && (
                      <span className="truncate text-paragraph-xs text-text-sub-600">
                        {splitHighlights(t.snippet).map((part, i) =>
                          part.mark ? (
                            <mark key={i} className="rounded-sm bg-primary-alpha-16 text-text-strong-950">{part.text}</mark>
                          ) : (
                            <span key={i}>{part.text}</span>
                          ),
                        )}
                      </span>
                    )}
                  </span>
                  <span className="ml-2 shrink-0 truncate text-paragraph-xs text-text-soft-400">{t.projectName}</span>
                </CommandMenu.Item>
              ))}
            </CommandMenu.Group>
          )}
          {actions.length > 0 && (
            <CommandMenu.Group heading="Actions">
              {actions.map((a) => (
                <CommandMenu.Item key={a.id} value={`action-${a.id}`} onSelect={() => run(a)}>
                  <CommandMenu.ItemIcon as={a.command === 'new-task' ? IconPlus : IconArrowRight} aria-hidden="true" />
                  <span className="truncate">{a.label}</span>
                </CommandMenu.Item>
              ))}
            </CommandMenu.Group>
          )}
        </CommandMenu.List>
        <CommandMenu.Footer className="max-sm:hidden">
          <div className="flex items-center gap-2 text-paragraph-xs text-text-sub-600">
            <CommandMenu.FooterKeyBox><IconArrowUp className="size-3.5" aria-hidden="true" /></CommandMenu.FooterKeyBox>
            <CommandMenu.FooterKeyBox><IconArrowDown className="size-3.5" aria-hidden="true" /></CommandMenu.FooterKeyBox>
            Navigate
            <CommandMenu.FooterKeyBox><IconCornerDownLeft className="size-3.5" aria-hidden="true" /></CommandMenu.FooterKeyBox>
            Open
          </div>
          <div className="flex items-center gap-2 text-paragraph-xs text-text-sub-600">
            <CommandMenu.FooterKeyBox className="w-auto px-1">esc</CommandMenu.FooterKeyBox>
            Close
          </div>
        </CommandMenu.Footer>
      </CommandMenu.Dialog>
    </>
  );
}
