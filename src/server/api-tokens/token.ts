import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
// 62^43 > 2^256, so 43 base62 digits hold any 32-byte value: every token has the same length.
const DIGITS = 43;
const PATTERN = /^tk_[0-9A-Za-z]{43}$/;

/** tk_ + 32 random bytes in base62. Shown to the user once. */
export function generateApiToken(): string {
  let n = BigInt(`0x${randomBytes(32).toString('hex')}`);
  const base = BigInt(62);
  let out = '';
  for (let i = 0; i < DIGITS; i += 1) {
    out = ALPHABET[Number(n % base)] + out;
    n /= base;
  }
  return `tk_${out}`;
}

/**
 * SHA-256, not a slow hash: the token is 256 random bits, so stretching adds
 * nothing, and a plain digest keeps lookup to one indexed equality.
 */
export function hashApiToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function tokenPrefix(raw: string): string {
  return raw.slice(0, 8);
}

/** Cheap check before touching the database. */
export function isApiTokenShape(raw: string): boolean {
  return PATTERN.test(raw);
}
