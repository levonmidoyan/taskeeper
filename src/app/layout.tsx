import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { googleCredentials, requireEmailVerification } from '@/lib/auth-config';
import { fontVariables } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Taskeeper',
  description: 'Task management for small teams',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Providers
            requireEmailVerification={requireEmailVerification()}
            google={googleCredentials() !== null}
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
