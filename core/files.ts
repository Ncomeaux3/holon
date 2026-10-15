import { serviceClient } from './db'

// One private bucket per module. Health records, insurance declarations pages,
// home warranties and vault attachments all land here, and none of them are
// ever public: reading one is a signed URL that expires.

/** Buckets are named after the module, so a module owns exactly one. */
function bucketFor(module: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(module)) throw new Error(`Not a module id: ${module}`)
  return module
}

const SIGNED_URL_SECONDS = 60 * 10

/**
 * Creates the module's bucket if it is not there yet.
 *
 * Done on demand rather than in a migration: buckets are not schema, and a
 * module that never stores a file should not have one. Private always, so a
 * missed policy cannot expose a lab result.
 */
async function ensureBucket(module: string): Promise<string> {
  const bucket = bucketFor(module)
  const supabase = serviceClient()

  const { data } = await supabase.storage.getBucket(bucket)
  if (data) return bucket

  const { error } = await supabase.storage.createBucket(bucket, { public: false })
  // A concurrent call may have won the race, which is not a failure.
  if (error && !/already exists/i.test(error.message)) throw error

  return bucket
}

export type StoredFile = { module: string; path: string }

/**
 * `path` is relative to the module's bucket, so a caller cannot reach into
 * another module's files by passing a traversal.
 */
export async function upload(
  module: string,
  path: string,
  body: ArrayBuffer | Blob | Buffer,
  contentType?: string,
): Promise<StoredFile> {
  if (path.includes('..') || path.startsWith('/')) {
    throw new Error(`Not a relative path inside the bucket: ${path}`)
  }

  const bucket = await ensureBucket(module)
  const { error } = await serviceClient()
    .storage.from(bucket)
    // upsert so a re-import or a retried job replaces the file rather than
    // failing on a name that is already there.
    .upload(path, body, { contentType, upsert: true })

  if (error) throw error
  return { module, path }
}

/**
 * A short lived URL for one file. Nothing here is ever public, so this is the
 * only way a stored file reaches a browser.
 */
export async function signedUrl(
  file: StoredFile,
  expiresInSeconds = SIGNED_URL_SECONDS,
): Promise<string> {
  const { data, error } = await serviceClient()
    .storage.from(bucketFor(file.module))
    .createSignedUrl(file.path, expiresInSeconds)

  if (error || !data) throw error ?? new Error('No signed URL returned')
  return data.signedUrl
}

/** The stored bytes, for a job that has to read a file back (a retried transcription). */
export async function download(file: StoredFile): Promise<Blob> {
  const { data, error } = await serviceClient()
    .storage.from(bucketFor(file.module))
    .download(file.path)

  if (error || !data) throw error ?? new Error('No file returned')
  return data
}

export async function remove(file: StoredFile): Promise<void> {
  const { error } = await serviceClient()
    .storage.from(bucketFor(file.module))
    .remove([file.path])
  if (error) throw error
}
