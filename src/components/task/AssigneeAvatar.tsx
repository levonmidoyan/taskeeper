'use client';

import { Hint } from '@/components/shell/ShortcutHint';
import { UserAvatar } from '@/components/auth/user/user-avatar';
import { cn } from '@/utils/cn';

export function AssigneeAvatar({
  name,
  image,
  className,
}: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  // The span carries the tooltip: UserAvatar takes no ref.
  return (
    <Hint label={`Assigned to ${name}`}>
      <span className="inline-flex shrink-0">
        <UserAvatar
          user={{ name, image }}
          role="img"
          aria-label={`Assigned to ${name}`}
          className={cn('size-6 text-[0.625rem]', className)}
        />
      </span>
    </Hint>
  );
}
