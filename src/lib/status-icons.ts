/**
 * The glyphs a column can be given, by key. Keys only, so the server can
 * validate a choice without importing the icon components.
 */
export const STATUS_ICON_KEYS = [
  'circle-dashed', 'circle', 'circle-half', 'circle-check', 'progress', 'clock',
  'eye', 'flag', 'bug', 'rocket', 'star', 'bolt', 'flame', 'bulb',
  'pause', 'ban', 'archive', 'inbox',
] as const;

export type StatusIconKey = (typeof STATUS_ICON_KEYS)[number];

export function isStatusIconKey(value: string | null | undefined): value is StatusIconKey {
  return value != null && (STATUS_ICON_KEYS as readonly string[]).includes(value);
}
