// Stable accent per project or workspace, derived from its id, so lists get colour
// without anyone having to pick one. Literal class names keep Tailwind able to see them.
// A project may override it by storing one of these keys in project.color.
export const PROJECT_COLORS = [
  { key: 'indigo', label: 'Indigo', dot: 'bg-indigo-500' },
  { key: 'fuchsia', label: 'Fuchsia', dot: 'bg-fuchsia-500' },
  { key: 'sky', label: 'Sky', dot: 'bg-sky-500' },
  { key: 'emerald', label: 'Emerald', dot: 'bg-emerald-500' },
  { key: 'amber', label: 'Amber', dot: 'bg-amber-500' },
  { key: 'rose', label: 'Rose', dot: 'bg-rose-500' },
  { key: 'violet', label: 'Violet', dot: 'bg-violet-500' },
  { key: 'teal', label: 'Teal', dot: 'bg-teal-500' },
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number]['key'];

export const PROJECT_COLOR_KEYS = PROJECT_COLORS.map((c) => c.key) as [ProjectColor, ...ProjectColor[]];

const dots = PROJECT_COLORS.map((c) => c.dot);

const tiles = [
  'from-indigo-500 to-violet-500',
  'from-fuchsia-500 to-pink-500',
  'from-sky-500 to-indigo-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-fuchsia-500',
  'from-violet-500 to-fuchsia-500',
  'from-teal-500 to-sky-500',
];

function bucket(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % dots.length;
}

/** Solid background class for a small marker dot. */
export function tintDot(key: string): string {
  return dots[bucket(key)];
}

/** Gradient stops for an avatar-style tile; pair with `bg-linear-to-br`. */
export function tintTile(key: string): string {
  return tiles[bucket(key)];
}

/**
 * The color a project shows: its picked one, or the id-derived default for
 * projects that never picked (their column still holds the legacy 'primary').
 */
export function projectColor(project: { id: string; color: string }): ProjectColor {
  const picked = PROJECT_COLORS.find((c) => c.key === project.color);
  return picked ? picked.key : PROJECT_COLORS[bucket(project.id)].key;
}

/** Solid background class for a project's marker dot. */
export function projectDot(project: { id: string; color: string }): string {
  const key = projectColor(project);
  return PROJECT_COLORS.find((c) => c.key === key)!.dot;
}
