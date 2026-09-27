'use client';

import { dashClient } from '@better-auth/infra/client';
import {
  adminClient,
  deviceAuthorizationClient,
  emailOTPClient,
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
    // Audit log reads for the signed-in user; needs the server dash plugin.
    dashClient(),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
