import { describe, expect, it } from 'vitest';
import { MARK_END as E, MARK_START as S, splitHighlights } from '@/lib/highlights';

describe('splitHighlights', () => {
  it('splits marked words from plain text', () => {
    expect(splitHighlights(`run the ${S}migration${E} then ${S}smoke${E} tests`)).toEqual([
      { text: 'run the ', mark: false },
      { text: 'migration', mark: true },
      { text: ' then ', mark: false },
      { text: 'smoke', mark: true },
      { text: ' tests', mark: false },
    ]);
  });

  it('keeps HTML as plain text', () => {
    expect(splitHighlights(`<b>${S}x${E}</b>`)).toEqual([
      { text: '<b>', mark: false },
      { text: 'x', mark: true },
      { text: '</b>', mark: false },
    ]);
  });

  it('keeps literal guillemets as text', () => {
    expect(splitHighlights(`say «hi» to ${S}ops${E}`)).toEqual([
      { text: 'say «hi» to ', mark: false },
      { text: 'ops', mark: true },
    ]);
  });

  it('tolerates an unclosed marker', () => {
    expect(splitHighlights(`a ${S}b`)).toEqual([
      { text: 'a ', mark: false },
      { text: 'b', mark: true },
    ]);
  });
});
