import nodemailer, { type Transporter } from 'nodemailer';

/**
 * SMTP settings from the environment, or null to log emails instead of sending
 * them. Any mailbox with SMTP access works without a custom domain, e.g. Gmail
 * (smtp.gmail.com, port 465, the account address and an app password).
 */
export function smtpConfig(): {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
} | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  return {
    host,
    port,
    // 465 speaks TLS from the first byte; 587 and 25 upgrade with STARTTLS.
    secure: port === 465,
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
  };
}

let transporter: Transporter | undefined;

export function smtpTransport(config: NonNullable<ReturnType<typeof smtpConfig>>): Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    // Nodemailer's defaults (2 min to connect, 10 min idle socket) would let
    // one stuck server outlast the reminders cron's whole send budget.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

/**
 * Replies that mean "not now": servers throttle (421, 450, 451) or run out of
 * room (452) with these, and the same send usually goes through a little later.
 */
const TRY_LATER = new Set([421, 450, 451, 452]);

/**
 * A stable code for a failed send, taken from the SMTP reply code or
 * Nodemailer's error code — never the message, which can carry the address.
 * `rate_limit_exceeded` is the one callers wait out and retry.
 */
export function smtpErrorCode(error: unknown): string {
  const e = error as { responseCode?: number; code?: string } | null;
  if (typeof e?.responseCode === 'number') {
    return TRY_LATER.has(e.responseCode) ? 'rate_limit_exceeded' : `smtp_${e.responseCode}`;
  }
  return e?.code ?? 'unknown';
}
