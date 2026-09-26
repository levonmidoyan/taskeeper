import {
  ChangeEmailConfirmationEmail,
  type EmailColors,
  EmailVerificationEmail,
  OrganizationInvitationEmail,
  PasswordChangedEmail,
  ResetPasswordEmail,
} from '@better-auth-ui/react/email';
import type { ReactElement } from 'react';
import { render } from 'react-email';
import { Resend } from 'resend';
import { appUrl } from '@/lib/url';

const apiKey = process.env.RESEND_API_KEY;

/**
 * Sender address. The domain must be verified in Resend, otherwise every send
 * is rejected. `onboarding@resend.dev` is Resend's shared sandbox sender and
 * only delivers to the account owner's own address — useful before the real
 * domain is verified.
 */
const from = process.env.EMAIL_FROM ?? 'Taskeeper <onboarding@resend.dev>';

/**
 * Align tokens (src/styles/align-tokens.css) as hex: email clients do not
 * understand oklch or CSS variables, so the templates get literal colors.
 */
const colors: EmailColors = {
  light: {
    background: '#F7F7F7',
    border: '#EBEBEB',
    card: '#FFFFFF',
    cardForeground: '#171717',
    foreground: '#262626',
    muted: '#F7F7F7',
    mutedForeground: '#5C5C5C',
    primary: '#335CFF',
    primaryForeground: '#FFFFFF',
  },
  dark: {
    background: '#171717',
    border: '#262626',
    card: '#1C1C1C',
    cardForeground: '#FFFFFF',
    foreground: '#EBEBEB',
    muted: '#262626',
    mutedForeground: '#A3A3A3',
    primary: '#4D82FF',
    primaryForeground: '#FFFFFF',
  },
};

/** Props every better-auth-ui template shares. */
const brand = { appName: 'Taskeeper', colors, darkMode: true, poweredBy: false } as const;

/** Better Auth's default token lifetime for verification and reset links. */
const LINK_EXPIRY_MINUTES = 60;

/**
 * Without an API key, emails log their link to the server console instead
 * of failing. Development and CI then work with no external account, and the
 * invite and verification flows are still fully exercisable.
 */
export async function sendInviteEmail(invite: {
  to: string;
  url: string;
  workspaceName: string;
  role: 'admin' | 'member';
  inviter?: { name: string; email: string };
  expiresInDays: number;
}): Promise<void> {
  await send('invite', invite.to, invite.url, {
    subject: `Join ${invite.workspaceName} on Taskeeper`,
    email: (
      <OrganizationInvitationEmail
        {...brand}
        url={invite.url}
        email={invite.to}
        organizationName={invite.workspaceName}
        role={invite.role === 'admin' ? 'an admin' : 'a member'}
        inviterName={invite.inviter?.name}
        inviterEmail={invite.inviter?.email}
        localization={{
          INVITED_TO_JOIN_ORGANIZATION:
            '{inviterName} ({inviterEmail}) has invited you to join the {organizationName} workspace on {appName} as {role}.',
          THIS_INVITATION_EXPIRES_IN_HOURS: `This invitation expires in ${invite.expiresInDays} days.`,
        }}
      />
    ),
  });
}

/** Sign-up confirmation, and the link to a new address after an email change. */
export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  await send('verify-email', to, url, {
    subject: 'Verify your email for Taskeeper',
    email: (
      <EmailVerificationEmail
        {...brand}
        url={url}
        email={to}
        expirationMinutes={LINK_EXPIRY_MINUTES}
      />
    ),
  });
}

export async function sendResetPasswordEmail(to: string, url: string): Promise<void> {
  await send('reset-password', to, url, {
    subject: 'Reset your Taskeeper password',
    email: (
      <ResetPasswordEmail {...brand} url={url} email={to} expirationMinutes={LINK_EXPIRY_MINUTES} />
    ),
  });
}

/** Sent after a reset, so a takeover through a stolen inbox does not go unnoticed. */
export async function sendPasswordChangedEmail(to: string): Promise<void> {
  const timestamp = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date());

  await send('password-changed', to, null, {
    subject: 'Your Taskeeper password was changed',
    email: (
      <PasswordChangedEmail
        {...brand}
        email={to}
        timestamp={`${timestamp} UTC`}
        secureAccountURL={`${appUrl()}/auth/forgot-password`}
      />
    ),
  });
}

/**
 * Goes to the current address before an email change: the change only starts
 * once its owner approves, then the new address gets a verification link.
 */
export async function sendChangeEmailConfirmation(
  to: string,
  newEmail: string,
  url: string,
): Promise<void> {
  await send('change-email', to, url, {
    subject: 'Approve your Taskeeper email change',
    email: (
      <ChangeEmailConfirmationEmail
        {...brand}
        url={url}
        currentEmail={to}
        newEmail={newEmail}
        expirationMinutes={LINK_EXPIRY_MINUTES}
      />
    ),
  });
}

async function send(
  kind: string,
  to: string,
  url: string | null,
  message: { subject: string; email: ReactElement },
): Promise<void> {
  if (!apiKey) {
    console.info(`[${kind}] ${to}${url ? ` -> ${url}` : ''}`);
    return;
  }

  const [html, text] = await Promise.all([
    render(message.email),
    render(message.email, { plainText: true }),
  ]);

  const resend = new Resend(apiKey);
  // The SDK reports API failures (unverified domain, restricted key, rate
  // limit) in `error` rather than by throwing, so an unchecked call looks like
  // a successful send while nothing is delivered.
  const { error } = await resend.emails.send({ from, to, subject: message.subject, html, text });

  if (error) {
    throw new Error(`Resend rejected the ${kind} email to ${to}: ${error.name} — ${error.message}`);
  }
}
