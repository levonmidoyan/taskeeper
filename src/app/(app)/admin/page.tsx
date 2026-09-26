import { viewPaths } from '@better-auth-ui/core';
import { redirect } from 'next/navigation';

export default function AdminIndexPage() {
  redirect(`/admin/${viewPaths.admin.users}`);
}
