import * as Avatar from '@/components/ui/avatar';

type AvatarSize = '20' | '24' | '32';

/** A user's photo, or the first letter of their name when they have none. */
export function UserAvatar({
  name,
  image,
  size = '24',
  className,
  ...rest
}: {
  name: string;
  image?: string | null;
  size?: AvatarSize;
  className?: string;
} & Pick<React.HTMLAttributes<HTMLDivElement>, 'role' | 'aria-label' | 'aria-hidden'>) {
  return (
    <Avatar.Root size={size} color="blue" className={className} {...rest}>
      {image ? <Avatar.Image src={image} alt="" /> : name.slice(0, 1)}
    </Avatar.Root>
  );
}

export function AssigneeAvatar({
  name,
  image,
  className,
}: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  return <UserAvatar name={name} image={image} role="img" aria-label={`Assigned to ${name}`} className={className} />;
}
