import { OfflineRetry } from './OfflineRetry';

export const metadata = { title: 'Offline · Taskeeper' };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-title-h5 text-text-strong-950">You’re offline</h1>
      <p className="max-w-sm text-paragraph-sm text-text-sub-600">Taskeeper needs a connection. Check your network and try again.</p>
      <OfflineRetry />
    </main>
  );
}
