import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;

/**
 * Sender address. The domain must be verified in Resend, otherwise every send
 * is rejected. `onboarding@resend.dev` is Resend's shared sandbox sender and
 * only delivers to the account owner's own address — useful before the real
 * domain is verified.
 */
const from = process.env.EMAIL_FROM ?? 'Taskeeper <onboarding@resend.dev>';

/**
 * Without an API key, emails log their link to the server console instead
 * of failing. Development and CI then work with no external account, and the
 * invite and verification flows are still fully exercisable.
 */
export async function sendInviteEmail(
  to: string,
  url: string,
  workspaceName: string,
): Promise<void> {
  await send('invite', to, url, {
    subject: `Join ${workspaceName} on Taskeeper`,
    text: `You have been invited to join ${workspaceName}.\n\nAccept: ${url}\n\nThis link expires in 7 days.`,
  });
}

export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  await send('verify-email', to, url, {
    subject: 'Verify your email for Taskeeper',
    text: `Confirm this is your email address to finish setting up your Taskeeper account.\n\nVerify: ${url}\n\nThis link expires in 1 hour. If you did not sign up, ignore this email.`,
  });
}

async function send(
  kind: string,
  to: string,
  url: string,
  message: { subject: string; text: string },
): Promise<void> {
  if (!apiKey) {
    console.info(`[${kind}] ${to} -> ${url}`);
    return;
  }

  const resend = new Resend(apiKey);
  // The SDK reports API failures (unverified domain, restricted key, rate
  // limit) in `error` rather than by throwing, so an unchecked call looks like
  // a successful send while nothing is delivered.
  const { error } = await resend.emails.send({ from, to, ...message });

  if (error) {
    throw new Error(`Resend rejected the ${kind} email to ${to}: ${error.name} — ${error.message}`);
  }
}
