import { describe, expect, it } from 'vitest';
import { normalizeLinkUrl } from '@/components/kibo-ui/editor/link';
import { filterSlashItems } from '@/components/kibo-ui/editor/slash-items';

describe('normalizeLinkUrl', () => {
  it('accepts web and mail links', () => {
    expect(normalizeLinkUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(normalizeLinkUrl('http://example.com')).toBe('http://example.com/');
    expect(normalizeLinkUrl('mailto:a@b.co')).toBe('mailto:a@b.co');
  });

  it('adds https:// to a bare domain', () => {
    expect(normalizeLinkUrl('example.com/docs')).toBe('https://example.com/docs');
  });

  it('rejects scripts, other schemes and junk', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('data:text/html,hi')).toBeNull();
    expect(normalizeLinkUrl('not a url')).toBeNull();
    expect(normalizeLinkUrl('   ')).toBeNull();
  });
});

describe('filterSlashItems', () => {
  it('returns every item for an empty query', () => {
    expect(filterSlashItems('').map((i) => i.title)).toEqual([
      'Text', 'To-do list', 'Heading 1', 'Heading 2', 'Heading 3',
      'Bullet list', 'Numbered list', 'Quote', 'Code block',
    ]);
  });

  it('matches titles and search terms, case-insensitively', () => {
    expect(filterSlashItems('HEAD').map((i) => i.title)).toEqual(['Heading 1', 'Heading 2', 'Heading 3']);
    expect(filterSlashItems('todo').map((i) => i.title)).toEqual(['To-do list']);
    expect(filterSlashItems('zzz')).toEqual([]);
  });
});
