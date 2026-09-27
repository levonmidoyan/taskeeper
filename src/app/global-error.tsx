'use client';

import { useEffect } from 'react';
import { ErrorScreen } from '@/components/brand/ErrorScreen';
import { fontVariables } from './fonts';
import './globals.css';

/*
 * Replaces the root layout when it throws, so there is no ThemeProvider here: mirror
 * next-themes' choice (stored under "theme", "system" by default) onto <html> by hand.
 */
export default function GlobalError(props: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('theme');
    } catch {}
    const dark =
      stored === 'dark' || ((!stored || stored === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  }, []);

  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <title>Something went wrong · Taskeeper</title>
        <ErrorScreen {...props} />
      </body>
    </html>
  );
}
