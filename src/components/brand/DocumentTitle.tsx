'use client';

/*
 * React-hoisted <title> for boundary pages. not-found can't export metadata (only
 * global-not-found can), and a <title> rendered from its server tree is dropped.
 */
export function DocumentTitle({ children }: { children: string }) {
  return <title>{children}</title>;
}
