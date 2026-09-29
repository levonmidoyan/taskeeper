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
  return (
    <UserAvatar
      user={{ name, image }}
      role="img"
      aria-label={`Assigned to ${name}`}
      className={cn('size-6 text-[0.625rem]', className)}
    />
  );
}
