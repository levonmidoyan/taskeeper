import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/auth/ui/card';
import { FormError } from '@/components/forms/TextField';
import { InviteAnswer } from '@/components/invite/InviteAnswer';
import { auth } from '@/lib/auth';
import { getInvitationPreview } from '@/server/members/service';

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  // Send them to sign up, then straight back here.
  if (!session) redirect(`/auth/sign-up?redirectTo=/invite/${invitationId}`);

  // Only a preview: rendering the page must not join the workspace.
  const preview = await getInvitationPreview(session.user.email, invitationId);

  if (!preview.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>This invitation cannot be used</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FormError>{preview.error}</FormError>
          <p className="text-paragraph-sm text-text-sub-600">Ask whoever invited you to send a new one.</p>
          <Link href="/" className="text-label-sm text-primary-base underline-offset-4 hover:underline">
            Go to your workspaces
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { workspaceName, role, inviterName } = preview.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join {workspaceName}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-paragraph-sm text-text-sub-600">
          {inviterName ? `${inviterName} invited you` : 'You were invited'} to join {workspaceName} as {role === 'admin' ? 'an admin' : `a ${role}`}.
        </p>
        <InviteAnswer invitationId={invitationId} />
      </CardContent>
    </Card>
  );
}
