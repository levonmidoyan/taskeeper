'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import { settle } from '@/lib/settle';
import { acceptInvitationAction, declineInvitationAction } from '@/server/members/actions';

/** Joining takes a click: opening the link alone never answers the invitation. */
export function InviteAnswer({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  async function accept() {
    setPending('accept');
    setError(null);
    const result = await settle(acceptInvitationAction(invitationId));
    if (!result.ok) {
      setError(result.error);
      setPending(null);
      return;
    }
    router.push(`/${result.data.slug}`);
  }

  async function decline() {
    setPending('decline');
    setError(null);
    const result = await settle(declineInvitationAction(invitationId));
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDeclined(true);
  }

  if (declined) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-paragraph-sm text-text-sub-600">Invitation declined.</p>
        <Link href="/" className="text-label-sm text-primary-base underline-offset-4 hover:underline">
          Go to your workspaces
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <Button.Root type="button" onClick={accept} disabled={pending !== null} className="flex-1">
          {pending === 'accept' ? 'Joining…' : 'Accept'}
        </Button.Root>
        <Button.Root
          type="button"
          variant="neutral"
          mode="stroke"
          onClick={decline}
          disabled={pending !== null}
          className="flex-1"
        >
          {pending === 'decline' ? 'Declining…' : 'Decline'}
        </Button.Root>
      </div>
    </div>
  );
}
