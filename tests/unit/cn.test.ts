import { describe, expect, it } from 'vitest';
import { cn } from '@/utils/cn';

describe('cn', () => {
  it('keeps an Align font size next to an Align text colour', () => {
    // Both start with "text-"; without the custom font-size group tailwind-merge
    // treats them as the same group and drops one.
    expect(cn('text-label-sm', 'text-text-sub-600')).toBe('text-label-sm text-text-sub-600');
  });

  it('lets the later Align font size win', () => {
    expect(cn('text-label-sm', 'text-paragraph-md')).toBe('text-paragraph-md');
  });

  it('lets the later Align shadow and radius win', () => {
    expect(cn('shadow-regular-xs', 'shadow-regular-md')).toBe('shadow-regular-md');
    expect(cn('rounded-10', 'rounded-lg')).toBe('rounded-lg');
  });

  it('still drops falsy values like clsx', () => {
    expect(cn('p-2', false && 'hidden', undefined, 'p-4')).toBe('p-4');
  });
});
