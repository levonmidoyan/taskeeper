'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { handleEditorEscape } from '@/components/task/RichTextField';
import { TaskDetailView, type TaskDetailViewProps } from '@/components/task/TaskDetailView';
import * as Modal from '@/components/ui/modal';

export function TaskDetailDialog(props: TaskDetailViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function close() {
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    const query = next.toString();
    router.push(query ? `?${query}` : '?', { scroll: false });
  }

  return (
    <Modal.Root open onOpenChange={(open) => { if (!open) close(); }}>
      <Modal.Content
        aria-describedby={undefined}
        showClose={false}
        // Fixed-size shell: the header stays put and each column scrolls on
        // its own, so the page behind never needs to. Full screen on phones.
        overlayClassName="p-0 sm:p-4"
        className="flex h-dvh max-w-6xl flex-col overflow-hidden rounded-none sm:h-[90vh] sm:rounded-20"
        // Focus the dialog itself, not its first button: that is Delete, and it
        // opened with a focus ring one keypress away from the confirm.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        // Escape that closes an editor's slash menu or link field stops there.
        onEscapeKeyDown={(event) => { if (handleEditorEscape(event)) event.preventDefault(); }}
      >
        <Modal.Title className="sr-only">Task details</Modal.Title>
        <TaskDetailView mode="modal" {...props} />
      </Modal.Content>
    </Modal.Root>
  );
}
