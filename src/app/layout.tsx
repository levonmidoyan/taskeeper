import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { ServiceWorkerRegister } from '@/components/brand/ServiceWorkerRegister';
import { TopLoadingBar } from '@/components/brand/TopLoadingBar';
import { Providers } from '@/components/providers';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { googleCredentials, requireEmailVerification } from '@/lib/auth-config';
import { REQUEST_PATH_HEADER, redirectToFromPath } from '@/lib/request-path';
import { fontVariables } from './fonts';
import { THEME_DARK, THEME_LIGHT } from './theme-colors';
import './globals.css';

export const metadata: Metadata = {
  title: 'Taskeeper',
  description: 'Task management for small teams',
  appleWebApp: { capable: true, title: 'Taskeeper', statusBarStyle: 'default' },
};

// Matches the app header (bg-white-0) in each scheme; cover lets the bars pad for the notch.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: THEME_DARK },
  ],
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const redirectTo = redirectToFromPath((await headers()).get(REQUEST_PATH_HEADER));

  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TopLoadingBar />
          <ServiceWorkerRegister />
          <Providers
            requireEmailVerification={requireEmailVerification()}
            google={googleCredentials() !== null}
            redirectTo={redirectTo}
          >
            {children}
          </Providers>
          {/* aria-live, and never steals focus. The offset clears the phone's bottom bar (globals.css). */}
          <Toaster position="bottom-right" offset={{ bottom: 'var(--toast-bottom)' }} mobileOffset={{ bottom: 'var(--toast-bottom)' }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
