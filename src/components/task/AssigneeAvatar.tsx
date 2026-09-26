import * as Avatar from '@/components/ui/avatar';

export function AssigneeAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar.Root size="24" color="blue" role="img" aria-label={`Assigned to ${name}`} className={className}>
      {name.slice(0, 1)}
    </Avatar.Root>
  );
}
