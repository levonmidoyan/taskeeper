import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listMyWorkspaces } from '@/server/workspaces/queries';

export default async function RootPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');

  const workspaces = await listMyWorkspaces(session.user.id);
  if (workspaces.length === 0) redirect('/new-workspace');

  redirect(`/${workspaces[0].slug}`);
}
