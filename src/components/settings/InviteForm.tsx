'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as Label from '@/components/ui/label';
import * as Radio from '@/components/ui/radio';
import { inviteMemberAction } from '@/server/members/actions';

const ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const;

export function InviteForm({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = event.currentTarget;
    const email = String(new FormData(form).get('email'));
    const result = await inviteMemberAction(workspaceSlug, { email, role });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    form.reset();
    toast.success(`Invitation sent to ${email}.`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200"
    >
      <TextField
        id="invite-email" label="Invite by email" name="email" type="email" required
        autoComplete="off" placeholder="teammate@example.com"
        aria-describedby={error ? 'invite-error' : undefined}
      />

      <div className="flex flex-col gap-2">
        <span id="invite-role-label" className="text-label-sm text-text-strong-950">Role</span>
        <Radio.Group
          aria-labelledby="invite-role-label"
          value={role}
          onValueChange={(v) => setRole(v as 'admin' | 'member')}
          className="flex gap-5"
        >
          {ROLES.map(({ value, label }) => (
            <div key={value} className="flex items-center gap-2">
              <Radio.Item value={value} id={`invite-role-${value}`} />
              <Label.Root htmlFor={`invite-role-${value}`} className="text-paragraph-sm">
                {label}
              </Label.Root>
            </div>
          ))}
        </Radio.Group>
        <p className="text-paragraph-xs text-text-sub-600">
          Admins can invite and remove people. Members cannot.
        </p>
      </div>

      {error && <FormError id="invite-error">{error}</FormError>}

      <div>
        <Button.Root type="submit" size="small" disabled={pending}>
          {pending ? 'Sending…' : 'Send invite'}
        </Button.Root>
      </div>
    </form>
  );
}
