/**
 * Client-safe mirror of storage.ts's size limits (that file is
 * server-only). Upload forms check against these before submitting, so an
 * oversized file gets a clear message immediately instead of failing
 * partway through.
 *
 * MAX_DIRECT_UPLOAD_BYTES matches storage.ts's MAX_DIRECT_UPLOAD_BYTES —
 * for forms that upload straight to R2 via uploadFileDirect() (see
 * upload-client.ts), which isn't constrained by Vercel's 4.5MB request
 * body limit. MAX_LEGACY_UPLOAD_BYTES matches MAX_FILE_SIZE_BYTES — for
 * any upload spot still sending raw bytes through a server action/API
 * route body, which is.
 */
export const MAX_DIRECT_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_DIRECT_UPLOAD_LABEL = "50MB";

export const MAX_LEGACY_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_LEGACY_UPLOAD_LABEL = "4MB";

// Matches presign-public/route.ts's PUBLIC_MAX_BYTES — for the public,
// unauthenticated /apply careers page, which uses a tighter cap than
// signed-in direct uploads since anyone on the internet can call it.
export const MAX_PUBLIC_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_PUBLIC_UPLOAD_LABEL = "8MB";

// Back-compat aliases — default to the legacy (server-body) limit; call
// sites that have moved to direct upload should use the DIRECT constants
// above explicitly.
export const MAX_UPLOAD_BYTES = MAX_LEGACY_UPLOAD_BYTES;
export const MAX_UPLOAD_LABEL = MAX_LEGACY_UPLOAD_LABEL;

export function fileTooLarge(file: File, maxBytes: number = MAX_LEGACY_UPLOAD_BYTES): boolean {
  return file.size > maxBytes;
}
