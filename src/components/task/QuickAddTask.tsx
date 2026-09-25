'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { createTaskAction } from '@/server/tasks/actions';

export function QuickAddTask({
  workspaceSlug,
  projectId,
  statusId,
  placeholder = 'Add a task…',
}: {
  workspaceSlug: string;
  projectId: string;
  statusId?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = inputRef.current?.value.trim();
    if (!title || pending) return;

    // Cleared up front, not after the round trip: the field has to be ready for
    // the next title immediately, which is the whole point of quick add. The
    // input is never disabled either — disabling blurs it, and re-enabling does
    // not restore focus, so the second task could not be typed without reaching
    // for the mouse.
    if (inputRef.current) inputRef.current.value = '';

    setPending(true);
    const result = await createTaskAction(workspaceSlug, { projectId, title, statusId });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      // Hand the title back rather than losing what was typed, but only if the
      // user has not already started the next one.
      if (inputRef.current && inputRef.current.value === '') inputRef.current.value = title;
      return;
    }

    router.refresh();
  }

  return (
    // relative, so the sr-only label below resolves its containing block here
    // rather than at the viewport. In the board's horizontally scrolling strip
    // an unpositioned absolute label escapes the scroll container and stretches
    // the page itself sideways.
    <form onSubmit={onSubmit} className="relative flex items-center gap-2">
      <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <label htmlFor={`quick-add-${statusId ?? 'default'}`} className="sr-only">
        {placeholder}
      </label>
      <input
        id={`quick-add-${statusId ?? 'default'}`}
        ref={inputRef}
        name="title"
        maxLength={200}
        aria-busy={pending}
        placeholder={placeholder}
        className="h-11 w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground lg:text-sm"
      />
    </form>
  );
}
