import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { admin, deviceAuthorization, organization } from 'better-auth/plugins';
import { db } from '@/db';
import * as schema from '@/db/schema';
import {
  adminUserIds,
  deviceClientIds,
  googleCredentials,
  requireEmailVerification,
} from '@/lib/auth-config';
import {
  sendChangeEmailConfirmation,
  sendPasswordChangedEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
} from '@/lib/email';
import { appUrl, trustedOrigins } from '@/lib/url';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: appUrl(),
  // Without this, the trusted list is just baseURL, and any request arriving on
  // another valid host (Vercel preview/deployment domain) fails with
  // "Invalid origin".
  trustedOrigins: trustedOrigins(),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: requireEmailVerification(),
    sendResetPassword: ({ user, url }) => sendResetPasswordEmail(user.email, url),
    onPasswordReset: ({ user }) => sendPasswordChangedEmail(user.email),
    // A reset is how a locked-out owner takes the account back; sessions opened
    // with the old password must not outlive it.
    revokeSessionsOnPasswordReset: true,
  },
  // Google sign-in and sign-up share one button: an unknown Google account gets
  // a new user. Off until both credentials are set, so dev and CI need none.
  socialProviders: (() => {
    const google = googleCredentials();
    return google ? { google } : {};
  })(),
  user: {
    // Settings → Account. The current address approves the change first
    // (sendChangeEmailConfirmation); Better Auth then mails the new address a
    // verification link (sendVerificationEmail below) and switches only once
    // it is clicked.
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: ({ user, newEmail, url }) =>
        sendChangeEmailConfirmation(user.email, newEmail, url),
    },
  },
  emailVerification: {
    sendVerificationEmail: ({ user, url }) => sendVerificationEmail(user.email, url),
    // Accounts created before verification was required sign in unverified;
    // this resends their link instead of leaving them stuck on the error.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
  },
  // On by default, and it must stay on in production — it is what stops
  // credential stuffing against sign-in. The end-to-end suite signs up several
  // accounts in a row from one address and trips it, so the test runner opts
  // out explicitly rather than the app guessing from NODE_ENV: the e2e run is a
  // production build, so NODE_ENV cannot tell the two apart.
  rateLimit: { enabled: process.env.AUTH_RATE_LIMIT !== 'off' },
  plugins: [
    organization(),
    // App-wide admin (user management, bans, impersonation) — separate from the
    // per-workspace owner/admin/member roles, which live on `member`.
    admin({ adminUserIds: adminUserIds() }),
    // OAuth 2.0 device flow (RFC 8628) for CLIs and TVs: the device shows a code,
    // the user enters it at /auth/device and approves. Codes default to 8 chars,
    // matching the UI plugin's userCodeLength.
    deviceAuthorization({
      verificationUri: '/auth/device',
      validateClient: (clientId) => {
        const allowed = deviceClientIds();
        return allowed.length === 0 || allowed.includes(clientId);
      },
    }),
    // nextCookies must be last: it wraps the response so Server Actions can set
    // cookies. Any plugin after it would not have its cookies applied.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
