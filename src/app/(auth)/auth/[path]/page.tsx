import { viewPaths } from '@better-auth-ui/core';
import { notFound } from 'next/navigation';
import { Auth } from '@/components/auth/auth';

const validAuthPaths = new Set(Object.values(viewPaths.auth));

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (!validAuthPaths.has(path)) notFound();

  return <Auth path={path} />;
}
