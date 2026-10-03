import { describe, expect, it } from 'vitest';
import { toPrefixQuery } from '@/server/tasks/search-query';

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
