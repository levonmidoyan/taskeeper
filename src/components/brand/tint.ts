// Stable accent per project or workspace, derived from its id, so lists get colour
// without anyone having to pick one. Literal class names keep Tailwind able to see them.
const dots = [
  'bg-indigo-500',
  'bg-fuchsia-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-teal-500',
];

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
