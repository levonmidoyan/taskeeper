import {
  ChangeEmailConfirmationEmail,
  DeleteAccountVerificationEmail,
  type EmailColors,
  EmailVerificationEmail,
  OrganizationInvitationEmail,
  OtpEmail,
  PasswordChangedEmail,
  ResetPasswordEmail,
} from '@better-auth-ui/react/email';
import type { ReactElement } from 'react';
import { render } from 'react-email';
import { DigestEmail, ReminderEmail } from '@/lib/reminder-email';
import { digestSubject, reminderSubject, type MailSender } from '@/lib/reminders';
import { smtpConfig, smtpErrorCode, smtpTransport } from '@/lib/smtp';
import { appUrl } from '@/lib/url';

const smtp = smtpConfig();

/** A send the mail server refused. `code` comes from smtpErrorCode, e.g. 'rate_limit_exceeded'. */
export class EmailSendError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/**
 * Sender address. Defaults to the SMTP login, the one address every provider
 * lets that account send as; Gmail rewrites any other From to it anyway.
 */
const from =
  process.env.EMAIL_FROM || `Taskeeper <${smtp?.user ?? 'noreply@localhost'}>`;

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
 * Lifetimes of the emailed one-time codes. Passed to the plugins in auth.ts as
 * well, so the "expires in" line always matches what the server enforces.
 */
export const SIGN_IN_CODE_EXPIRY_MINUTES = 5;
export const TWO_FACTOR_CODE_EXPIRY_MINUTES = 3;
export const DELETE_ACCOUNT_LINK_EXPIRY_HOURS = 24;

/**
 * Without SMTP_HOST, emails log their link to the server console instead
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

/** Passwordless sign-in code (email OTP plugin). */
export async function sendSignInCodeEmail(to: string, code: string): Promise<void> {
  await sendCode('sign-in-code', to, code, {
    subject: `${code} is your Taskeeper sign-in code`,
    email: (
      <OtpEmail
        {...brand}
        verificationCode={code}
        email={to}
        expirationMinutes={SIGN_IN_CODE_EXPIRY_MINUTES}
        localization={{
          VERIFY_YOUR_EMAIL: 'Sign in to Taskeeper',
          WE_NEED_TO_VERIFY_YOUR_EMAIL_ADDRESS: 'Enter this code to sign in to {appName}.',
        }}
      />
    ),
  });
}

/** Second-factor code for accounts with two-factor authentication turned on. */
export async function sendTwoFactorCodeEmail(to: string, code: string): Promise<void> {
  await sendCode('two-factor-code', to, code, {
    subject: `${code} is your Taskeeper verification code`,
    email: (
      <OtpEmail
        {...brand}
        verificationCode={code}
        email={to}
        expirationMinutes={TWO_FACTOR_CODE_EXPIRY_MINUTES}
        localization={{
          VERIFY_YOUR_EMAIL: 'Your verification code',
          WE_NEED_TO_VERIFY_YOUR_EMAIL_ADDRESS:
            'Enter this code to finish signing in to {appName}. If you did not just sign in, change your password.',
        }}
      />
    ),
  });
}

/** Account deletion only happens once this link is clicked. */
export async function sendDeleteAccountEmail(to: string, url: string): Promise<void> {
  await send('delete-account', to, url, {
    subject: 'Confirm deleting your Taskeeper account',
    email: (
      <DeleteAccountVerificationEmail
        {...brand}
        url={url}
        email={to}
        expirationHours={DELETE_ACCOUNT_LINK_EXPIRY_HOURS}
      />
    ),
  });
}

/** Reminder and digest emails from the reminders cron (src/server/reminders/run.ts). */
export const sendNotificationEmail: MailSender = async (mail) => {
  // SMTP has no idempotency keys. A stable Message-ID at least lets Gmail and
  // other clients that dedupe on it hide a retry of a send that went through
  // but was never marked sent.
  const messageId = `<notification.${mail.notificationId}@${new URL(appUrl()).hostname}>`;
  if (mail.kind === 'reminder') {
    const url = `${appUrl()}/${mail.slug}/tasks/${mail.taskId}`;
    await send('reminder', mail.to, url, {
      subject: reminderSubject(mail.data),
      email: <ReminderEmail data={mail.data} url={url} />,
      messageId,
    });
    return;
  }
  const url = `${appUrl()}/${mail.slug}/calendar`;
  await send('digest', mail.to, url, {
    subject: digestSubject(mail.data, mail.workspaceName),
    email: <DigestEmail data={mail.data} workspaceName={mail.workspaceName} url={url} />,
    messageId,
  });
};

/**
 * Codes are not links, so the console fallback in send() would print nothing
 * useful; this logs the code itself instead.
 */
async function sendCode(
  kind: string,
  to: string,
  code: string,
  message: { subject: string; email: ReactElement },
): Promise<void> {
  if (!smtp) {
    console.info(`[${kind}] ${to} -> ${code}`);
    return;
  }
  await send(kind, to, null, message);
}

async function send(
  kind: string,
  to: string,
  url: string | null,
  message: { subject: string; email: ReactElement; messageId?: string },
): Promise<void> {
  if (!smtp) {
    console.info(`[${kind}] ${to}${url ? ` -> ${url}` : ''}`);
    return;
  }

  const [html, text] = await Promise.all([
    render(message.email),
    render(message.email, { plainText: true }),
  ]);

  try {
    await smtpTransport(smtp).sendMail({
      from,
      to,
      subject: message.subject,
      html,
      text,
      messageId: message.messageId,
    });
  } catch (error) {
    const code = smtpErrorCode(error);
    throw new EmailSendError(`The mail server rejected the ${kind} email to ${to}: ${code}`, code);
  }
}
