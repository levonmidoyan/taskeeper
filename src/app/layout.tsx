import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { TopLoadingBar } from '@/components/brand/TopLoadingBar';
import { Providers } from '@/components/providers';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { googleCredentials, requireEmailVerification } from '@/lib/auth-config';
import { REQUEST_PATH_HEADER, redirectToFromPath } from '@/lib/request-path';
import { fontVariables } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Taskeeper',
  description: 'Task management for small teams',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const redirectTo = redirectToFromPath((await headers()).get(REQUEST_PATH_HEADER));

  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TopLoadingBar />
          <Providers
            requireEmailVerification={requireEmailVerification()}
            google={googleCredentials() !== null}
            redirectTo={redirectTo}
          >
            {children}
          </Providers>
          {/* aria-live, and never steals focus. */}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
