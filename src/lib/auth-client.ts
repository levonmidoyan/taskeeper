'use client';

import { dashClient, sentinelClient } from '@better-auth/infra/client';
import {
  adminClient,
  deviceAuthorizationClient,
  emailOTPClient,
  multiSessionClient,
  organizationClient,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  plugins: [
    organizationClient(),
    adminClient(),
    deviceAuthorizationClient(),
    // No onTwoFactorRedirect: better-auth-ui's sign-in continuation routes a
    // twoFactorRedirect response to /auth/two-factor itself.
    twoFactorClient(),
    emailOTPClient(),
    multiSessionClient(),
    // Audit log reads for the signed-in user; needs the server dash plugin.
    dashClient(),
    // Browser fingerprint + proof-of-work solver for the server sentinel
    // plugin. Same public flag as sentinelEnabled(), so dev and CI make no
    // calls to kv.better-auth.com.
    ...(process.env.NEXT_PUBLIC_BETTER_AUTH_SENTINEL === 'true' ? [sentinelClient()] : []),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
