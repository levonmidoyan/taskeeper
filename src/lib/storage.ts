import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Lifetime of every presigned URL, upload and download alike. */
export const PRESIGN_SECONDS = 300;

let cached: { signature: string; client: S3Client } | null = null;

/** Read per call, not at import, so tests can swap the bucket in their env setup. */
export function bucketName(): string {
  return process.env.S3_BUCKET ?? '';
}

export function storageEnabled(): boolean {
  return Boolean(
    process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
  );
}

export function storageClient(): S3Client {
  const signature = [
    process.env.S3_ENDPOINT, process.env.S3_REGION, process.env.S3_ACCESS_KEY_ID,
  ].join('|');
  if (cached?.signature === signature) return cached.client;

  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    // MinIO needs path-style URLs; R2 accepts them too.
    forcePathStyle: true,
    // Newer SDKs add CRC32 checksum parameters to presigned PUTs by default.
    // A browser cannot compute them, and R2/MinIO then reject the upload.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  cached = { signature, client };
  return client;
}

/**
 * Content-Type and Content-Length are signed, so the browser cannot upload a
 * different type or a bigger file than the server agreed to.
 */
export async function presignPut(input: { key: string; contentType: string; size: number }): Promise<string> {
  return getSignedUrl(
    storageClient(),
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.size,
    }),
    { expiresIn: PRESIGN_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) },
  );
}

/** `disposition` is a full Content-Disposition value from contentDisposition(). */
export async function presignGet(input: { key: string; contentType: string; disposition: string }): Promise<string> {
  return getSignedUrl(
    storageClient(),
    new GetObjectCommand({
      Bucket: bucketName(),
      Key: input.key,
      ResponseContentType: input.contentType,
      ResponseContentDisposition: input.disposition,
      ResponseCacheControl: 'private, max-age=300',
    }),
    { expiresIn: PRESIGN_SECONDS },
  );
}

export async function headObject(key: string): Promise<{ size: number; contentType: string | null } | null> {
  try {
    const head = await storageClient().send(new HeadObjectCommand({ Bucket: bucketName(), Key: key }));
    return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

/** Idempotent: deleting a missing key succeeds. */
export async function deleteObject(key: string): Promise<void> {
  await storageClient().send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await storageClient().send(new ListObjectsV2Command({
      Bucket: bucketName(), Prefix: prefix, ContinuationToken: token,
    }));
    for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** DeleteObjects takes at most 1000 keys per call. */
export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await storageClient().send(new DeleteObjectsCommand({
      Bucket: bucketName(),
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }));
  }
}

/** Dev and test setup only; production buckets are created in the R2 dashboard. */
export async function ensureBucket(bucket: string): Promise<void> {
  try {
    await storageClient().send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await storageClient().send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
