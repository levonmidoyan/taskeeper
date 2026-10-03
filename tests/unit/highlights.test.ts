import { describe, expect, it } from 'vitest';
import { splitHighlights } from '@/lib/highlights';

describe('splitHighlights', () => {
  it('splits marked words from plain text', () => {
    expect(splitHighlights('run the «migration» then «smoke» tests')).toEqual([
      { text: 'run the ', mark: false },
      { text: 'migration', mark: true },
      { text: ' then ', mark: false },
      { text: 'smoke', mark: true },
      { text: ' tests', mark: false },
    ]);
  });

  it('keeps HTML as plain text', () => {
    expect(splitHighlights('<b>«x»</b>')).toEqual([
      { text: '<b>', mark: false },
      { text: 'x', mark: true },
      { text: '</b>', mark: false },
    ]);
  });

  it('tolerates an unclosed marker', () => {
    expect(splitHighlights('a «b')).toEqual([
      { text: 'a ', mark: false },
      { text: 'b', mark: true },
    ]);
  });
});
