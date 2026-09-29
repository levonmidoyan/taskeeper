import { beforeEach, describe, expect, it } from 'vitest';
import { deleteObject, headObject, presignGet, presignPut } from '@/lib/storage';
import { resetBucket, uploadTo } from '../setup/storage';

beforeEach(resetBucket);

const bytes = new TextEncoder().encode('hello world');

describe('storage', () => {
  it('uploads through a presigned PUT and reports the size', async () => {
    const url = await presignPut({ key: 'ws/a/tasks/b/c', contentType: 'text/plain', size: bytes.length });

    const res = await uploadTo(url, bytes, 'text/plain');

    expect(res.ok).toBe(true);
    expect(await headObject('ws/a/tasks/b/c')).toEqual({ size: bytes.length, contentType: 'text/plain' });
  });

  // Review Focus 1.
  it('rejects a body of a different size than was signed', async () => {
    const url = await presignPut({ key: 'ws/a/tasks/b/big', contentType: 'text/plain', size: 3 });

    const res = await uploadTo(url, bytes, 'text/plain');

    expect(res.ok).toBe(false);
    expect(await headObject('ws/a/tasks/b/big')).toBeNull();
  });

  it('rejects a different content type than was signed', async () => {
    const url = await presignPut({ key: 'ws/a/tasks/b/type', contentType: 'text/plain', size: bytes.length });

    const res = await uploadTo(url, bytes, 'text/html');

    expect(res.ok).toBe(false);
  });

  it('serves a presigned GET with the requested disposition', async () => {
    const put = await presignPut({ key: 'k1', contentType: 'text/plain', size: bytes.length });
    await uploadTo(put, bytes, 'text/plain');

    const url = await presignGet({
      key: 'k1', contentType: 'application/octet-stream', disposition: 'attachment; filename="a.txt"',
    });
    const res = await fetch(url);

    expect(await res.text()).toBe('hello world');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="a.txt"');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('returns null for a missing object and deletes idempotently', async () => {
    expect(await headObject('missing')).toBeNull();
    await expect(deleteObject('missing')).resolves.toBeUndefined();
  });
});
