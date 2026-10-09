'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useSyncExternalStore, ViewTransition } from 'react';
import { handleEditorEscape } from '@/components/task/RichTextField';
import { TaskDetailView, type TaskDetailViewProps } from '@/components/task/TaskDetailView';
import * as Modal from '@/components/ui/modal';
import { handOffEscape } from '@/lib/local-escape';
import { TASK_CLOSE, TASK_MODAL_CLASSES, taskTransitionName } from '@/lib/motion';
import { collectNavItems, focusNavItem, navTarget } from '@/lib/shortcuts/nav';
import { useShortcut } from '@/lib/shortcuts/provider';

export function TaskDetailDialog(props: TaskDetailViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // After hydration the portal gets its container up front, so the modal mounts in
  // the navigation's own commit and its view transition pairs with the card's.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);

  function close() {
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    const query = next.toString();
    router.push(query ? `?${query}` : '?', { scroll: false, transitionTypes: [TASK_CLOSE] });
  }

  // j/k step through the tasks of the view behind, in its order (same column
  // on the board). A task that is not there (a subtask, filtered out) stays put.
  function step(dir: 'next' | 'prev') {
    const target = navTarget(collectNavItems(), props.task.id, dir);
    if (!target) return;
    const next = new URLSearchParams(searchParams);
    next.set('task', target);
    router.replace(`?${next.toString()}`, { scroll: false });
  }
  useShortcut('detail.next', () => step('next'));
  useShortcut('detail.prev', () => step('prev'));

  return (
    <Modal.Root open onOpenChange={(open) => { if (!open) close(); }}>
      <Modal.Content
        aria-describedby={undefined}
        data-shortcut-scope="detail"
        showClose={false}
        container={hydrated ? document.body : undefined}
        // Fixed-size shell: the header stays put and each column scrolls on
        // its own, so the page behind never needs to. Full screen on phones.
        overlayClassName="p-0 sm:p-4"
        // The visible shell is the inner panel, which the view transition morphs
        // from the card (or pops in); Radix's own zoom would animate on top of it.
        className="flex h-dvh max-w-6xl flex-col rounded-none bg-transparent shadow-none data-[state=open]:animate-none sm:h-[90vh] sm:rounded-20"
        // Focus the dialog itself, not its first button: that is Delete, and it
        // opened with a focus ring one keypress away from the confirm.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        // Escape that closes an editor's slash menu or link field, or ends an edit
        // in progress (the description's), stops there.
        onEscapeKeyDown={(event) => {
          if (handleEditorEscape(event) || handOffEscape(event)) event.preventDefault();
        }}
        // Back to the card or row of the task shown last, which after j/k is
        // not the one that opened the dialog.
        onCloseAutoFocus={(event) => {
          if (focusNavItem(props.task.id)) event.preventDefault();
        }}
      >
        <Modal.Title className="sr-only">Task details</Modal.Title>
        <ViewTransition name={taskTransitionName(props.task.id)} {...TASK_MODAL_CLASSES}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit] bg-bg-white-0 shadow-regular-md">
            <TaskDetailView mode="modal" {...props} />
          </div>
        </ViewTransition>
      </Modal.Content>
    </Modal.Root>
  );
}
