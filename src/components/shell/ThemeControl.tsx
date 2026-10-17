'use client';

import { IconDeviceDesktop, IconMoon, IconSun, type TablerIcon } from '@tabler/icons-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import * as SegmentedControl from '@/components/ui/segmented-control';
import { Hint } from '@/components/shell/ShortcutHint';

type Theme = 'system' | 'light' | 'dark';

const themes: { key: Theme; icon: TablerIcon; label: string }[] = [
  { key: 'system', icon: IconDeviceDesktop, label: 'System theme' },
  { key: 'light', icon: IconSun, label: 'Light theme' },
  { key: 'dark', icon: IconMoon, label: 'Dark theme' },
];

export function ThemeControl() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  // The stored theme is unknown until mounted, so nothing is selected on the server and the
  // first client render. Same markup both times, no layout shift.
  const value = mounted ? (theme ?? 'system') : '';

  return (
    <SegmentedControl.Root value={value} onValueChange={setTheme}>
      <SegmentedControl.List aria-label="Theme" className="w-auto">
        {themes.map(({ key, icon: Icon, label }) => (
          <SegmentedControl.Trigger key={key} value={key} aria-label={label} className="w-7">
            <Hint label={label}>
              <span className="flex size-full items-center justify-center">
                <Icon aria-hidden="true" className="size-4" />
              </span>
            </Hint>
          </SegmentedControl.Trigger>
        ))}
      </SegmentedControl.List>
    </SegmentedControl.Root>
  );
}
