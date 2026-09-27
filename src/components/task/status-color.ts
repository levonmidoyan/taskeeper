/**
 * Status colours are free-form names; the three seeded ones get a hue and
 * anything else falls back to grey. Full class strings, so Tailwind sees them.
 */
const STATUS_TEXT: Record<string, string> = {
  muted: 'text-faded-base',
  primary: 'text-primary-base',
  success: 'text-success-base',
};

const STATUS_BG: Record<string, string> = {
  muted: 'bg-faded-base',
  primary: 'bg-primary-base',
  success: 'bg-success-base',
};

export function statusText(color: string): string {
  return STATUS_TEXT[color] ?? STATUS_TEXT.muted;
}

export function statusBg(color: string): string {
  return STATUS_BG[color] ?? STATUS_BG.muted;
}
