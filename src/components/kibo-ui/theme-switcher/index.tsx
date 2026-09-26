'use client';

/**
 * Kibo UI Theme Switcher — haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263,
 * packages/theme-switcher/index.tsx. Adapted:
 * - Tabler icons instead of lucide.
 * - radiogroup / radio / aria-checked semantics, one tab stop, arrow keys select.
 * - Controlled only (next-themes owns the state), so @radix-ui/react-use-controllable-state
 *   is not needed.
 * - Renders all three buttons unselected before mount instead of returning null, using
 *   useSyncExternalStore rather than a setState-in-effect mount flag. Same markup on the
 *   server and the first client render, and no layout shift.
 * - Align tokens.
 */

import { IconDeviceDesktop, IconMoon, IconSun, type TablerIcon } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useSyncExternalStore } from 'react';
import { cn } from '@/utils/cn';

export type Theme = 'light' | 'dark' | 'system';

const themes: { key: Theme; icon: TablerIcon; label: string }[] = [
  { key: 'system', icon: IconDeviceDesktop, label: 'System theme' },
  { key: 'light', icon: IconSun, label: 'Light theme' },
  { key: 'dark', icon: IconMoon, label: 'Dark theme' },
];

export type ThemeSwitcherProps = {
  value?: Theme;
  onChange: (theme: Theme) => void;
  className?: string;
};

export function ThemeSwitcher({ value, onChange, className }: ThemeSwitcherProps) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  // Until mounted the stored theme is unknown; "system" holds the tab stop meanwhile.
  const current: Theme = mounted ? (value ?? 'system') : 'system';

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = themes.findIndex((t) => t.key === current);
    const step = event.key === 'ArrowRight' ? 1 : themes.length - 1;
    const next = themes[(index + step) % themes.length];
    onChange(next.key);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-theme-key="${next.key}"]`)
      ?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
      className={cn(
        'relative isolate flex h-8 items-center rounded-full bg-bg-white-0 p-1 ring-1 ring-inset ring-stroke-soft-200',
        className,
      )}
    >
      {themes.map(({ key, icon: Icon, label }) => {
        const active = mounted && current === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            data-theme-key={key}
            aria-checked={active}
            aria-label={label}
            tabIndex={current === key ? 0 : -1}
            onClick={() => onChange(key)}
            className="relative size-6 rounded-full"
          >
            {active && (
              <motion.div
                layoutId="activeTheme"
                transition={{ type: 'spring', duration: 0.5 }}
                className="absolute inset-0 rounded-full bg-bg-weak-50 ring-1 ring-inset ring-stroke-soft-200"
              />
            )}
            <Icon
              aria-hidden="true"
              className={cn(
                'relative z-10 m-auto size-4',
                active ? 'text-text-strong-950' : 'text-text-soft-400',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
