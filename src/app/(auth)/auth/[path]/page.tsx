import { viewPaths } from '@better-auth-ui/core';
import { deviceAuthorizationPlugin } from '@better-auth-ui/core/plugins/device-authorization';
import { emailOtpPlugin } from '@better-auth-ui/core/plugins/email-otp';
import { twoFactorPlugin } from '@better-auth-ui/core/plugins/two-factor';
import { notFound } from 'next/navigation';
import { Auth } from '@/components/auth/auth';

const validAuthPaths = new Set([
  ...Object.values(viewPaths.auth),
  // Plugin views the <Auth> router resolves on top of the built-in ones.
  ...Object.values(deviceAuthorizationPlugin().viewPaths.auth),
  ...Object.values(twoFactorPlugin().viewPaths.auth),
  ...Object.values(emailOtpPlugin().viewPaths.auth),
]);

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (!validAuthPaths.has(path)) notFound();

  return <Auth path={path} />;
}
