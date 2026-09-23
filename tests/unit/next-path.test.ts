import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/next-path';

describe('safeNextPath', () => {
  it('passes through a same-origin path', () => {
    expect(safeNextPath('/invite/abc123')).toBe('/invite/abc123');
  });

  it('falls back when the parameter is missing', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined, '/home')).toBe('/home');
    expect(safeNextPath('')).toBe('/');
  });

  it('rejects an absolute URL', () => {
    expect(safeNextPath('https://evil.example/steal')).toBe('/');
  });

  it('rejects a protocol-relative URL, which the browser treats as another origin', () => {
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
  });
});
