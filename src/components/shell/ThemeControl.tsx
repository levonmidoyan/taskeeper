'use client';

import { useTheme } from 'next-themes';
import { ThemeSwitcher, type Theme } from '@/components/kibo-ui/theme-switcher';

export function ThemeControl() {
  const { theme, setTheme } = useTheme();
  return <ThemeSwitcher value={theme as Theme | undefined} onChange={setTheme} />;
}
