'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthProvider } from '@/components/auth/auth-provider';
import { authClient } from '@/lib/auth-client';
import { adminPlugin } from '@/lib/auth-ui/admin-plugin';
import { deviceAuthorizationPlugin } from '@/lib/auth-ui/device-authorization-plugin';
import { safeNextPath } from '@/lib/next-path';
import { getQueryClient } from '@/lib/query-client';

export function Providers({
  requireEmailVerification,
  children,
}: {
  requireEmailVerification: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <QueryClientProvider client={getQueryClient()}>
      <AuthProvider
        authClient={authClient}
        queryClient={getQueryClient()}
        redirectTo="/"
        plugins={[adminPlugin({ impersonationRedirectTo: '/' }), deviceAuthorizationPlugin()]}
        emailAndPassword={{
          requireEmailVerification,
          // The server has no reset-password email yet, so the link would dead-end.
          forgotPassword: false,
        }}
        // better-auth-ui takes ?redirectTo= from the URL as-is. An invite link
        // carries it, so it goes through the same same-origin check as ?next= did.
        navigate={({ to, replace }) => {
          const path = safeNextPath(to);
          if (replace) router.replace(path);
          else router.push(path);
        }}
        Link={Link}
      >
        {children}
      </AuthProvider>
    </QueryClientProvider>
  );
}
