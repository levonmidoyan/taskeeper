import { viewPaths } from '@better-auth-ui/core';
import { notFound } from 'next/navigation';
import { Admin } from '@/components/auth/admin/admin';
import { PageBreadcrumb } from '@/components/shell/PageBreadcrumb';

const adminLabels: Record<string, string> = {
  [viewPaths.admin.users]: 'Users',
};

export default async function AdminPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  const label = adminLabels[path];
  if (!label) notFound();

  return (
    <>
      <PageBreadcrumb className="mb-4" items={[{ label: 'Admin', href: '/admin' }, { label }]} />
      <Admin path={path} />
    </>
  );
}
