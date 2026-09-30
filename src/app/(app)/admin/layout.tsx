import { IconArrowLeft } from '@tabler/icons-react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LogoMark } from '@/components/brand/Logo';
import { UserButton } from '@/components/auth/user/user-button';
import { auth } from '@/lib/auth';
import { signInRedirect } from '@/lib/session';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return signInRedirect();

  // The admin API refuses non-admins on its own; this keeps the screen itself
  // from existing for them. Same check the users table makes client-side.
  const { success } = await auth.api.userHasPermission({
    body: { userId: session.user.id, permissions: { user: ['list'] } },
  });
  if (!success) notFound();

  return (
    <div className="min-h-dvh bg-bg-white-0">
      <header className="flex items-center justify-between gap-3 border-b border-stroke-soft-200 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-2">
          <LogoMark className="size-7" />
          <span className="h-5 w-px bg-stroke-soft-200" aria-hidden="true" />
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-label-sm text-text-sub-600 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950"
          >
            <IconArrowLeft className="size-4" aria-hidden="true" />
            Back to app
          </Link>
        </div>
        <UserButton size="icon" align="end" />
      </header>
      <main className="mx-auto w-full max-w-400 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
