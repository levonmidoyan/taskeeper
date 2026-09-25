'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/legacy-ui/select';
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

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th scope="col" className="py-2 font-medium">Name</th>
          <th scope="col" className="py-2 font-medium">Role</th>
          <th scope="col" className="py-2"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <tr key={member.userId} className="border-b border-border">
            <td className="py-3">
              <div className="font-medium text-foreground">{member.name}</div>
              <div className="text-xs text-muted-foreground">{member.email}</div>
            </td>
            <td className="py-3">
              {currentRole === 'owner' ? (
                <Select
                  value={member.role}
                  disabled={pending}
                  onValueChange={(v) => onRoleChange(member.userId, v as WorkspaceRole)}
                >
                  <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="capitalize text-muted-foreground">{member.role}</span>
              )}
            </td>
            <td className="py-3 text-right">
              {(currentRole === 'owner' || currentRole === 'admin')
                && member.userId !== currentUserId && (
                <button
                  type="button"
                  onClick={() => onRemove(member)}
                  disabled={pending}
                  className="h-11 rounded-[var(--radius-button)] px-3 text-sm text-destructive transition-colors duration-150 hover:bg-destructive/10 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
