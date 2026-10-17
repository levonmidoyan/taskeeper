'use client';

import { IconSearch, IconSubtask } from '@tabler/icons-react';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import * as Modal from '@/components/ui/modal';
import { settle } from '@/lib/settle';
import { parentCandidatesAction } from '@/server/tasks/actions';

const itemClass =
  'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-paragraph-sm text-text-strong-950 data-[selected=true]:bg-bg-weak-50';

export function ParentPickerDialog({
  open, onOpenChange, taskId, workspaceSlug, onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  workspaceSlug: string;
  onPick: (parent: { id: string; title: string }) => void;
}) {
  const [term, setTerm] = useState('');
  // The hits and the term they answer; loading until they answer the current one.
  const [found, setFound] = useState<{ term: string; hits: { id: string; title: string }[] } | null>(null);
  const hits = found?.hits ?? [];
  const loading = found?.term !== term;

  useEffect(() => {
    if (!open) return;
    let stale = false;
    // Debounced: one request per pause in typing.
    const timer = setTimeout(() => {
      void settle(parentCandidatesAction(workspaceSlug, taskId, term)).then((result) => {
        if (!stale) setFound({ term, hits: result.ok ? result.data : [] });
      });
    }, 150);
    return () => { stale = true; clearTimeout(timer); };
  }, [open, term, taskId, workspaceSlug]);

  function close() {
    setTerm('');
    setFound(null);
    onOpenChange(false);
  }

  return (
    <Modal.Root open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <Modal.Content className="max-w-md">
        <Modal.Header icon={IconSubtask} title="Make subtask of…" description="Pick a task in this project." />
        <Modal.Body className="p-0">
          <Command label="Parent task" shouldFilter={false}>
            <div className="flex items-center gap-2 border-b border-stroke-soft-200 px-3">
              <IconSearch className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
              <Command.Input
                value={term}
                onValueChange={setTerm}
                placeholder="Search tasks…"
                className="h-11 w-full bg-transparent text-paragraph-sm text-text-strong-950 outline-none placeholder:text-text-soft-400"
              />
            </div>
            <Command.List className="max-h-72 overflow-y-auto p-1">
              {!loading && <Command.Empty className="p-3 text-paragraph-sm text-text-sub-600">No matching tasks</Command.Empty>}
              {hits.map((h) => (
                <Command.Item key={h.id} value={h.id} onSelect={() => { close(); onPick(h); }} className={itemClass}>
                  <span className="truncate">{h.title}</span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
