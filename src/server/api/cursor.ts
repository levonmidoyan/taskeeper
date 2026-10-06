/** Opaque to clients; today it is a base64url row offset. */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

/** Null for anything that is not a cursor this API issued. */
export function decodeCursor(cursor: string): number | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^\d{1,9}$/.test(text)) return null;
  return Number(text);
}
