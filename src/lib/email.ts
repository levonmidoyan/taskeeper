import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;

/**
 * Without an API key, invitations log their link to the server console instead
 * of failing. Development and CI then work with no external account, and the
 * invite flow is still fully exercisable.
 */
export async function sendInviteEmail(
  to: string,
  url: string,
  workspaceName: string,
): Promise<void> {
  if (!apiKey) {
    console.info(`[invite] ${to} -> ${url} (${workspaceName})`);
    return;
  }

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: 'Taskeeper <invites@taskeeper.app>',
    to,
    subject: `Join ${workspaceName} on Taskeeper`,
    text: `You have been invited to join ${workspaceName}.\n\nAccept: ${url}\n\nThis link expires in 7 days.`,
  });
}
