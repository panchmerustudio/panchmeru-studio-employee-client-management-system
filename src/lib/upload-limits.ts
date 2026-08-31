/**
 * Client-safe mirror of storage.ts's MAX_FILE_SIZE_BYTES (that file is
 * server-only). Upload forms check against this before submitting, so an
 * oversized file gets a clear message instead of crashing into Vercel's
 * hard 4.5MB request-body limit after the fact — see next.config.ts and
 * storage.ts for why 4MB is the real ceiling, not an arbitrary choice.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "4MB";

export function fileTooLarge(file: File): boolean {
  return file.size > MAX_UPLOAD_BYTES;
}
