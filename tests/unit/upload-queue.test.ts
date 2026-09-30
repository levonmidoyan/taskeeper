import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { enqueue, patchItem, removeItem, startable, type UploadItem } from '@/lib/upload-queue';

let n = 0;
const makeId = () => `local-${++n}`;
const file = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'text/plain' });

describe('enqueue', () => {
  it('queues valid files and fails oversize or empty ones immediately', () => {
    const big = file('big.bin', 1);
    Object.defineProperty(big, 'size', { value: MAX_ATTACHMENT_BYTES + 1 });

    const items = enqueue([], [file('a.txt'), big, file('empty.txt', 0)], makeId);

    expect(items.map((i) => [i.file.name, i.state, i.error, i.retryable])).toEqual([
      ['a.txt', 'queued', null, false],
      ['big.bin', 'failed', 'Files can be up to 25 MB.', false],
      ['empty.txt', 'failed', 'Files can be up to 25 MB.', false],
    ]);
  });

  it('appends after existing items', () => {
    const first = enqueue([], [file('a.txt')], makeId);
    const both = enqueue(first, [file('b.txt')], makeId);
    expect(both.map((i) => i.file.name)).toEqual(['a.txt', 'b.txt']);
  });
});

describe('startable', () => {
  it('fills free slots up to three in order', () => {
    let items = enqueue([], ['1', '2', '3', '4', '5'].map((x) => file(x)), makeId);
    items = patchItem(items, items[0].localId, { state: 'uploading' });

    expect(startable(items).map((i) => i.file.name)).toEqual(['2', '3']);
  });

  it('returns nothing when three are running', () => {
    let items = enqueue([], ['1', '2', '3', '4'].map((x) => file(x)), makeId);
    for (const i of items.slice(0, 3)) items = patchItem(items, i.localId, { state: 'uploading' });
    expect(startable(items)).toEqual([]);
  });
});

describe('patchItem / removeItem', () => {
  it('changes one item and leaves the others', () => {
    const items = enqueue([], [file('a'), file('b')], makeId);
    const next = patchItem(items, items[1].localId, { loaded: 5 });
    expect(next[0]).toBe(items[0]);
    expect(next[1].loaded).toBe(5);
    expect(removeItem(next, items[0].localId).map((i: UploadItem) => i.file.name)).toEqual(['b']);
  });
});
