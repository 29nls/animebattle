/**
 * Helper client untuk Cloudflare R2 Object Storage (`env.FILES`).
 *
 * Binding R2 disediakan Freebuff Sites dan dibaca dari context Cloudflare.
 * Tipe `R2Bucket` dari `@cloudflare/workers-types` tidak dipakai karena paket
 * itu tidak terpasang; yang dibutuhkan di sini hanya tiga anggota yang memang
 * dipanggil, sehingga antarmuka lokal sudah cukup dan tetap type-safe.
 *
 * Context dibaca lewat simbol global yang sama dengan `src/lib/db/client.ts`,
 * bukan `getCloudflareContext()`: impor paket OpenNext menarik `wrangler` saat
 * dievaluasi di luar Worker, dan modul ini juga dipakai test Node.
 */

export interface R2ObjectMetadata {
  key: string;
  size: number;
  etag: string;
  httpMetadata?: {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
    cacheExpiry?: Date;
  };
  customMetadata?: Record<string, string>;
  uploaded: Date;
}

export interface R2PutOptions {
  contentType?: string;
  customMetadata?: Record<string, string>;
}

/** Anggota `R2Bucket` yang dipakai helper ini. */
interface R2BucketLike {
  put(
    key: string,
    value: string | ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> },
  ): Promise<{
    key: string;
    size: number;
    etag: string;
    uploaded: Date;
    customMetadata?: Record<string, string>;
  } | null>;
  get(key: string): Promise<{
    key: string;
    size: number;
    etag: string;
    uploaded: Date;
    body: ReadableStream;
    httpMetadata?: R2ObjectMetadata['httpMetadata'];
    customMetadata?: Record<string, string>;
  } | null>;
  delete(key: string): Promise<void>;
}

/**
 * Mengambil binding Cloudflare R2 `FILES` jika tersedia.
 *
 * `getCloudflareContext` melempar di luar runtime Cloudflare (test unit, build
 * statis, skrip CLI), jadi kegagalan di sini berarti "tidak ada binding" —
 * bukan kesalahan yang perlu dilaporkan.
 */
export function getR2Bucket(): R2BucketLike | null {
  try {
    const context = (globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')];
    const env = (context as { env?: Record<string, unknown> } | undefined)?.env;
    const bucket = env?.FILES;
    if (bucket && typeof (bucket as R2BucketLike).put === 'function') {
      return bucket as R2BucketLike;
    }
  } catch {
    // Context tidak tersedia (test unit, build statis, CLI) — bukan kesalahan.
  }
  return null;
}

/** Apakah R2 bucket `FILES` tersedia dan dapat digunakan? */
export function isR2Configured(): boolean {
  return getR2Bucket() !== null;
}

/** Menyimpan file atau buffer ke Cloudflare R2. */
export async function putFile(
  key: string,
  data: string | ArrayBuffer | Uint8Array | ReadableStream,
  options?: R2PutOptions,
): Promise<R2ObjectMetadata | null> {
  const bucket = getR2Bucket();
  if (!bucket) return null;

  const httpMetadata: Record<string, string> = {};
  if (options?.contentType) {
    httpMetadata.contentType = options.contentType;
  }

  const result = await bucket.put(key, data, {
    httpMetadata,
    customMetadata: options?.customMetadata,
  });

  if (!result) return null;

  return {
    key: result.key,
    size: result.size,
    etag: result.etag,
    uploaded: result.uploaded,
    customMetadata: result.customMetadata,
  };
}

/** Mengambil file dari Cloudflare R2. */
export async function getFile(
  key: string,
): Promise<{ data: ReadableStream; metadata: R2ObjectMetadata } | null> {
  const bucket = getR2Bucket();
  if (!bucket) return null;

  const object = await bucket.get(key);
  if (!object) return null;

  return {
    data: object.body,
    metadata: {
      key: object.key,
      size: object.size,
      etag: object.etag,
      uploaded: object.uploaded,
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
    },
  };
}

/** Menghapus file dari Cloudflare R2. */
export async function deleteFile(key: string): Promise<boolean> {
  const bucket = getR2Bucket();
  if (!bucket) return false;

  await bucket.delete(key);
  return true;
}
