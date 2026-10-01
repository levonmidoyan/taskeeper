'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthProvider } from '@/components/auth/auth-provider';
import { AddAccountDialog } from '@/components/auth/multi-session/add-account-dialog';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { authClient } from '@/lib/auth-client';
import { adminPlugin } from '@/lib/auth-ui/admin-plugin';
import { deleteUserPlugin } from '@/lib/auth-ui/delete-user-plugin';
import { deviceAuthorizationPlugin } from '@/lib/auth-ui/device-authorization-plugin';
import { emailOtpPlugin } from '@/lib/auth-ui/email-otp-plugin';
import { multiSessionPlugin } from '@/lib/auth-ui/multi-session-plugin';
import { twoFactorPlugin } from '@/lib/auth-ui/two-factor-plugin';
import { safeNextPath } from '@/lib/next-path';
import { getQueryClient } from '@/lib/query-client';

export function Providers({
  requireEmailVerification,
  google,
  redirectTo,
  children,
}: {
  requireEmailVerification: boolean;
  /** Whether the server has Google OAuth credentials; see googleCredentials(). */
  google: boolean;
  /** ?redirectTo= as the server saw it; the client reads it from the URL. */
  redirectTo: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <QueryClientProvider client={getQueryClient()}>
      <AuthProvider
        authClient={authClient}
        queryClient={getQueryClient()}
        redirectTo={redirectTo}
        plugins={[
          adminPlugin({ impersonationRedirectTo: '/' }),
          deviceAuthorizationPlugin(),
          // Options mirror the server plugins in src/lib/auth.ts.
          twoFactorPlugin(),
          emailOtpPlugin(),
          deleteUserPlugin({ sendDeleteAccountVerification: true }),
          multiSessionPlugin(),
        ]}
        emailAndPassword={{ requireEmailVerification }}
        socialProviders={google ? ['google'] : []}
        // better-auth-ui takes ?redirectTo= from the URL as-is. An invite link
        // carries it, so it goes through the same same-origin check as ?next= did.
        navigate={({ to, replace }) => {
          const path = safeNextPath(to);
          if (replace) router.replace(path);
          else router.push(path);
        }}
        Link={Link}
      >
        <ConfirmProvider>{children}</ConfirmProvider>
        <AddAccountDialog />
      </AuthProvider>
    </QueryClientProvider>
  );
}
