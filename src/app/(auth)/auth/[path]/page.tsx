import { viewPaths } from '@better-auth-ui/core';
import { deviceAuthorizationPlugin } from '@better-auth-ui/core/plugins/device-authorization';
import { emailOtpPlugin } from '@better-auth-ui/core/plugins/email-otp';
import { twoFactorPlugin } from '@better-auth-ui/core/plugins/two-factor';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { Auth } from '@/components/auth/auth';
import { ADD_ACCOUNT_COOKIE } from '@/lib/add-account-cookie';
import { auth } from '@/lib/auth';
import { signedInAuthRedirect } from '@/lib/signed-in-auth-redirect';

const validAuthPaths = new Set([
  ...Object.values(viewPaths.auth),
  // Plugin views the <Auth> router resolves on top of the built-in ones.
  ...Object.values(deviceAuthorizationPlugin().viewPaths.auth),
  ...Object.values(twoFactorPlugin().viewPaths.auth),
  ...Object.values(emailOtpPlugin().viewPaths.auth),
]);

export default async function AuthPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path } = await params;
  if (!validAuthPaths.has(path)) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    const addingAccount = (await cookies()).has(ADD_ACCOUNT_COOKIE);
    const to = signedInAuthRedirect(path, await searchParams, { addingAccount });
    if (to) redirect(to);
  }

  return <Auth path={path} />;
}
