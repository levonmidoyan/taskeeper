import { IconArrowLeft } from '@tabler/icons-react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UserButton } from '@/components/auth/user/user-button';
import { auth } from '@/lib/auth';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in?redirectTo=/settings');

  return (
    <div className="min-h-dvh bg-bg-white-0">
      <header className="flex items-center justify-between gap-3 border-b border-stroke-soft-200 px-4 py-2 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-label-sm text-text-sub-600 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950"
        >
          <IconArrowLeft className="size-4" aria-hidden="true" />
          Back to app
        </Link>
        <UserButton size="icon" align="end" />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6">
        <h1 className="text-title-h5 text-text-strong-950">Settings</h1>
        {children}
      </main>
    </div>
  );
}
