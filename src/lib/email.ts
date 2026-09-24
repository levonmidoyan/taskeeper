import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;

/**
 * Sender address. The domain must be verified in Resend, otherwise every send
 * is rejected. `onboarding@resend.dev` is Resend's shared sandbox sender and
 * only delivers to the account owner's own address — useful before the real
 * domain is verified.
 */
const from = process.env.EMAIL_FROM ?? 'Taskeeper <invites@taskeeper.app>';

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
  // The SDK reports API failures (unverified domain, restricted key, rate
  // limit) in `error` rather than by throwing, so an unchecked call looks like
  // a successful send while nothing is delivered.
  const { error } = await resend.emails.send({
    from,
    to,
    subject: `Join ${workspaceName} on Taskeeper`,
    text: `You have been invited to join ${workspaceName}.\n\nAccept: ${url}\n\nThis link expires in 7 days.`,
  });

  if (error) {
    throw new Error(`Resend rejected the invite to ${to}: ${error.name} — ${error.message}`);
  }
}
