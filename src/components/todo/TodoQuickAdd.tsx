'use client';

import { IconPlus } from '@tabler/icons-react';
import { addTransitionType, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { TODO_CHANGE } from '@/lib/motion';
import { settle } from '@/lib/settle';
import { createTodoAction } from '@/server/todos/actions';

export function TodoQuickAdd({ workspaceSlug }: { workspaceSlug: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = inputRef.current?.value.trim();
    if (!title) return;

    // Clear first and never disable (disabling blurs), so focus stays in the
    // field and the next item can be typed straight away.
    if (inputRef.current) inputRef.current.value = '';

    setPending(true);
    // A transition tagged like the list's own changes, so the new item animates in
    // when the action's revalidation renders it.
    startTransition(async () => {
      addTransitionType(TODO_CHANGE);
      const result = await settle(createTodoAction(workspaceSlug, { title }));
      startTransition(() => {
        setPending(false);
        if (!result.ok) {
          toast.error(result.error);
          if (inputRef.current && inputRef.current.value === '') inputRef.current.value = title;
        }
      });
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="relative flex items-center gap-2 rounded-xl bg-bg-white-0 px-3 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200 focus-within:ring-primary-base"
    >
      <IconPlus className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
      <label htmlFor="todo-quick-add" className="sr-only">Add a to-do</label>
      <input
        id="todo-quick-add"
        ref={inputRef}
        name="title"
        maxLength={200}
        aria-busy={pending}
        placeholder="Add a to-do…"
        className="h-11 w-full bg-transparent text-paragraph-md text-text-strong-950 placeholder:text-text-soft-400 lg:text-paragraph-sm"
      />
    </form>
  );
}
