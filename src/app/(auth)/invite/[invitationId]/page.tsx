import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
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
    <div className="space-y-4 rounded-[var(--radius-panel)] border border-border bg-card p-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">This invitation cannot be used</h1>
      <p role="alert" className="text-sm text-destructive">{result.error}</p>
      <p className="text-sm text-muted-foreground">Ask whoever invited you to send a new one.</p>
      <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
        Go to your workspaces
      </Link>
    </div>
  );
}
