'use client';

import { IconStar, IconStarFilled } from '@tabler/icons-react';
import { useOptimistic, useTransition } from 'react';
import { toast } from 'sonner';
import * as CompactButton from '@/components/ui/compact-button';
import { setProjectStarAction } from '@/server/projects/actions';
import { cn } from '@/utils/cn';

/** Stars a project for the current member. Flips at once; the rail catches up when the action revalidates. */
export function StarButton({
  workspaceSlug,
  projectId,
  starred,
  className,
}: {
  workspaceSlug: string;
  projectId: string;
  starred: boolean;
  className?: string;
}) {
  const [shown, setShown] = useOptimistic(starred);
  const [, startTransition] = useTransition();

  function toggle() {
    const next = !shown;
    startTransition(async () => {
      setShown(next);
      const result = await setProjectStarAction(workspaceSlug, { projectId, starred: next });
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <CompactButton.Root
      variant="ghost"
      size="large"
      onClick={toggle}
      aria-pressed={shown}
      aria-label={shown ? 'Unstar project' : 'Star project'}
      className={cn(shown && 'text-warning-base hover:text-warning-base', className)}
    >
      <CompactButton.Icon as={shown ? IconStarFilled : IconStar} />
    </CompactButton.Root>
  );
}
