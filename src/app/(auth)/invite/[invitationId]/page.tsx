import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/AuthCard';
import { FormError } from '@/components/forms/TextField';
import { auth } from '@/lib/auth';
import { acceptInvitation } from '@/server/members/service';

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  // Send them to sign up, then straight back here.
  if (!session) redirect(`/sign-up?next=/invite/${invitationId}`);

  const result = await acceptInvitation(session.user.id, session.user.email, invitationId);
  if (result.ok) redirect(`/${result.data.slug}`);

  return (
    <AuthCard title="This invitation cannot be used">
      <div className="flex flex-col gap-3">
        <FormError>{result.error}</FormError>
        <p className="text-paragraph-sm text-text-sub-600">Ask whoever invited you to send a new one.</p>
        <Link href="/" className="text-label-sm text-primary-base underline-offset-4 hover:underline">
          Go to your workspaces
        </Link>
      </div>
    </AuthCard>
  );
}
