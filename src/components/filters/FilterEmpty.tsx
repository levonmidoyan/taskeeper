'use client';

import { IconFilterOff } from '@tabler/icons-react';
import * as Button from '@/components/ui/button';
import type { TaskState } from '@/lib/task-filter';
import { useFilterNav } from './FilterScope';

export function FilterEmpty({ defaultState }: { defaultState: TaskState }) {
  const { apply } = useFilterNav();
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <IconFilterOff className="size-6 text-text-soft-400" aria-hidden="true" />
      <p className="text-paragraph-sm text-text-sub-600">No tasks match these filters.</p>
      <Button.Root variant="neutral" mode="stroke" size="xsmall" onClick={() => apply({ state: defaultState })}>
        Clear filters
      </Button.Root>
    </div>
  );
}
