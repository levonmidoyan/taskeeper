'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import * as Avatar from '@/components/ui/avatar';
import * as Button from '@/components/ui/button';
import * as Select from '@/components/ui/select';
import { changeMemberRoleAction, removeMemberAction } from '@/server/members/actions';
import type { MemberRow } from '@/server/labels/queries';
import type { WorkspaceRole } from '@/lib/session';

export function MemberTable({
  members,
  workspaceSlug,
  currentUserId,
  currentRole,
}: {
  members: MemberRow[];
  workspaceSlug: string;
  currentUserId: string;
  currentRole: WorkspaceRole;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onRoleChange(userId: string, role: WorkspaceRole) {
    startTransition(async () => {
      const result = await changeMemberRoleAction(workspaceSlug, { userId, role });
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  function onRemove(member: MemberRow) {
    if (!confirm(`Remove ${member.name} from this workspace?`)) return;
    startTransition(async () => {
      const result = await removeMemberAction(workspaceSlug, { userId: member.userId });
      if (!result.ok) toast.error(result.error);
      else toast.success(`${member.name} removed.`);
      router.refresh();
    });
  }

  // Below sm each row stacks — name on top, role and remove beneath — so the controls
  // stay on screen instead of in a sideways-scrolling strip. `relative` keeps the sr-only
  // header text inside the table's box; unpositioned, it escapes the overflow container
  // and stretches the page sideways.
  return (
    <div className="relative overflow-x-auto rounded-2xl ring-1 ring-inset ring-stroke-soft-200">
      <table className="w-full border-collapse text-paragraph-sm sm:min-w-[36rem]">
        <thead className="bg-bg-weak-50 max-sm:sr-only">
          <tr className="text-left text-label-xs uppercase text-text-soft-400">
            <th scope="col" className="px-4 py-2 font-medium">Name</th>
            <th scope="col" className="px-4 py-2 font-medium">Role</th>
            <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr
              key={member.userId}
              className="border-t border-stroke-soft-200 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:pb-3 max-sm:first:border-t-0"
            >
              <td className="px-4 py-3 max-sm:min-w-0 max-sm:basis-full">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar.Root size="32" color="blue">{member.name.slice(0, 1)}</Avatar.Root>
                  <div className="min-w-0">
                    <div className="truncate text-label-sm text-text-strong-950">{member.name}</div>
                    <div className="truncate text-paragraph-xs text-text-sub-600">{member.email}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 max-sm:py-0 max-sm:pl-15">
                {currentRole === 'owner' ? (
                  <Select.Root
                    size="small"
                    value={member.role}
                    disabled={pending}
                    onValueChange={(v) => onRoleChange(member.userId, v as WorkspaceRole)}
                  >
                    <Select.Trigger className="w-32" aria-label={`Role for ${member.name}`}>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="owner">Owner</Select.Item>
                      <Select.Item value="admin">Admin</Select.Item>
                      <Select.Item value="member">Member</Select.Item>
                    </Select.Content>
                  </Select.Root>
                ) : (
                  <span className="capitalize text-text-sub-600">{member.role}</span>
                )}
              </td>
              <td className="px-4 py-3 text-right max-sm:ml-auto max-sm:py-0">
                {(currentRole === 'owner' || currentRole === 'admin')
                  && member.userId !== currentUserId && (
                  <Button.Root
                    type="button"
                    variant="error"
                    mode="ghost"
                    size="xsmall"
                    onClick={() => onRemove(member)}
                    disabled={pending}
                  >
                    Remove
                  </Button.Root>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
