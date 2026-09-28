import { viewPaths } from '@better-auth-ui/core';
import { notFound } from 'next/navigation';
import { Admin } from '@/components/auth/admin/admin';

const validAdminPaths = new Set(Object.values(viewPaths.admin));

export default async function AdminPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (!validAdminPaths.has(path)) notFound();

  return <Admin path={path} />;
}
