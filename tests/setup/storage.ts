import { deleteObjects, ensureBucket, listKeys } from '@/lib/storage';

/** Creates the test bucket on first use and empties it. Call in beforeEach. */
export async function resetBucket(): Promise<void> {
  await ensureBucket(process.env.S3_BUCKET!);
  const keys = await listKeys('');
  if (keys.length) await deleteObjects(keys);
}

/** Does what the browser does with a presigned PUT URL. */
export function uploadTo(url: string, body: Uint8Array, contentType: string): Promise<Response> {
  // @types/node's Uint8Array is generic (Uint8Array<ArrayBufferLike>) and no longer
  // structurally matches lib.dom's BodyInit; the runtime value is a plain Uint8Array.
  return fetch(url, { method: 'PUT', body: body as BodyInit, headers: { 'content-type': contentType } });
}
