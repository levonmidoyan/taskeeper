import localFont from 'next/font/local';

// Self-hosted like the font it replaces (spec §10 A5): no build-time network fetch.
export const inter = localFont({
  src: './fonts/InterVariable.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
});

// Display face for headings. Latin subset of the OFL build (@fontsource-variable/plus-jakarta-sans 5.3.0).
export const jakarta = localFont({
  src: './fonts/PlusJakartaSansVariable.woff2',
  variable: '--font-jakarta',
  display: 'swap',
  weight: '200 800',
});

/** Font variables for <html>; shared by the root layout and global-error, which renders its own document. */
export const fontVariables = `${inter.variable} ${jakarta.variable}`;
