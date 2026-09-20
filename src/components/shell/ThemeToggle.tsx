'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Mount detection without a synchronous setState-in-effect: the server snapshot is
  // always `false`, the client snapshot is always `true`, so this flips to `true` on
  // the client after hydration without triggering a cascading render.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="inline-flex size-11 items-center justify-center rounded-[var(--radius-button)] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
    >
      {/* Render a stable icon until mounted, so server and client markup match. */}
      {mounted && isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}
