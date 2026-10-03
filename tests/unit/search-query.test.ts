import { describe, expect, it } from 'vitest';
import { plainSnippet, toPrefixQuery } from '@/server/tasks/search-query';

describe('toPrefixQuery', () => {
  it('turns words into ANDed prefix terms, lowercased', () => {
    expect(toPrefixQuery('Deploy Pipe')).toBe('deploy:* & pipe:*');
  });

  it('strips tsquery operators and punctuation', () => {
    expect(toPrefixQuery("a&b | !c:* (d) 'e'")).toBe('a:* & b:* & c:* & d:* & e:*');
  });

  it('returns null when nothing searchable remains', () => {
    expect(toPrefixQuery('&|!:*()')).toBeNull();
    expect(toPrefixQuery('   ')).toBeNull();
  });

  it('keeps Unicode letters and digits', () => {
    expect(toPrefixQuery('Ереван v2')).toBe('ереван:* & v2:*');
  });

  it('caps the number of terms at 8', () => {
    expect(toPrefixQuery('a b c d e f g h i j')!.split(' & ')).toHaveLength(8);
  });
});

describe('plainSnippet', () => {
  it('drops Markdown syntax but keeps highlight markers', () => {
    expect(plainSnippet('**Deploy** the [«api»](https://x.dev/a) with `npm` and ~~old~~ *notes*'))
      .toBe('Deploy the «api» with npm and old notes');
  });

  it('drops line markers and collapses line breaks', () => {
    expect(plainSnippet('## Steps\n- run «migration»\n> quoted\n1. done\n- [x] checked'))
      .toBe('Steps run «migration» quoted done checked');
  });

  it('keeps underscores inside words', () => {
    expect(plainSnippet('set «max_retries» to __3__')).toBe('set «max_retries» to 3');
  });
});
