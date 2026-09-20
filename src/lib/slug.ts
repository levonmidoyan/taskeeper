/**
 * Plain module, no directive: this is a synchronous function, and a
 * 'use server' module may only export async functions, so slugify cannot
 * live alongside the workspace actions.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    // Apostrophes are stripped outright rather than treated as separators, so
    // "Ada's Team" reads as "adas-team", not "ada-s-team".
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'workspace';
}
