import { dash } from '@better-auth/infra';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import {
  admin,
  deviceAuthorization,
  emailOTP,
  multiSession,
  organization,
  twoFactor,
} from 'better-auth/plugins';
import { db } from '@/db';
import * as schema from '@/db/schema';
import {
  adminUserIds,
  dashApiKey,
  deviceClientIds,
  googleCredentials,
  requireEmailVerification,
} from '@/lib/auth-config';
import {
  DELETE_ACCOUNT_LINK_EXPIRY_HOURS,
  sendChangeEmailConfirmation,
  sendDeleteAccountEmail,
  sendPasswordChangedEmail,
  sendResetPasswordEmail,
  sendSignInCodeEmail,
  sendTwoFactorCodeEmail,
  sendVerificationEmail,
  SIGN_IN_CODE_EXPIRY_MINUTES,
  TWO_FACTOR_CODE_EXPIRY_MINUTES,
} from '@/lib/email';
import { assertAccountDeletable, prepareAccountDeletion } from '@/server/account/deletion';
import { appUrl, trustedOrigins } from '@/lib/url';

/**
 * Answers every /organization/* request with 404, as disabledPaths would —
 * but by prefix, so an endpoint added in a Better Auth upgrade is covered too.
 * Server-side auth.api calls do not go through the router and are unaffected.
 */
function blockOrganizationEndpoints(): BetterAuthPlugin {
  return {
    id: 'block-organization-endpoints',
    onRequest: async (request, ctx) => {
      const prefix = `${new URL(ctx.baseURL).pathname.replace(/\/$/, '')}/organization/`;
      if (new URL(request.url).pathname.toLowerCase().startsWith(prefix.toLowerCase())) {
        return { response: new Response('Not Found', { status: 404 }) };
      }
    },
  };
}

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
    // Settings → Security → Danger zone. Nothing is deleted until the emailed
    // link is clicked. A last owner of a shared workspace is refused both when
    // asking and when confirming; workspaces only they belong to go with them.
    deleteUser: {
      enabled: true,
      deleteTokenExpiresIn: DELETE_ACCOUNT_LINK_EXPIRY_HOURS * 60 * 60,
      sendDeleteAccountVerification: async ({ user, url }) => {
        await assertAccountDeletable(user.id);
        await sendDeleteAccountEmail(user.email, url);
      },
      beforeDelete: (user) => prepareAccountDeletion(user.id),
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
  // production build, so NODE_ENV cannot tell the two apart. Counts go in the
  // rate_limit table: serverless instances do not share memory, so the default
  // in-memory store would give each instance its own count.
  rateLimit: { enabled: process.env.AUTH_RATE_LIMIT !== 'off', storage: 'database' },
  plugins: [
    // Kept for its schema (organization, member, invitation, session's active
    // organization) only. Workspaces, members and invitations are managed by the
    // app's own services, which enforce its role rules, reserved slugs and the
    // settings row; the plugin's HTTP endpoints would bypass all of that.
    organization(),
    blockOrganizationEndpoints(),
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
    // Second factor at sign-in, managed from Settings → Security: an
    // authenticator app (TOTP), a code emailed at sign-in (OTP), and backup
    // codes. Code lengths stay at the default 6, matching the UI plugin.
    twoFactor({
      issuer: 'Taskeeper',
      otpOptions: {
        period: TWO_FACTOR_CODE_EXPIRY_MINUTES, // minutes, unlike expiresIn below
        sendOTP: ({ user, otp }) => sendTwoFactorCodeEmail(user.email, otp),
      },
    }),
    // Passwordless sign-in with an emailed code ("Continue with Email Code").
    // Sign-in only: verification, password reset and email change keep their
    // link-based flows. disableSignUp matches the UI plugin's default, which
    // does not collect a name — new accounts still go through /auth/sign-up.
    emailOTP({
      disableSignUp: true,
      expiresIn: SIGN_IN_CODE_EXPIRY_MINUTES * 60,
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type === 'sign-in') await sendSignInCodeEmail(email, otp);
      },
    }),
    // Several accounts signed in on one browser, switched from the UserButton
    // menu and managed from Settings → Account. Up to 5 per device (default).
    multiSession(),
    // Better Auth Infrastructure dashboard: user management, audit log and
    // analytics at dash.better-auth.com. Only with an API key; activity tracking
    // stamps user.lastActiveAt at most every 5 minutes per active user.
    ...(() => {
      const apiKey = dashApiKey();
      return apiKey ? [dash({ apiKey, activityTracking: { enabled: true } })] : [];
    })(),
    // nextCookies must be last: it wraps the response so Server Actions can set
    // cookies. Any plugin after it would not have its cookies applied.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
