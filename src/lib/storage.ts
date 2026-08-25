import "server-only";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { db } from "@/db/client";
import { files as filesTable } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Object storage seam (spec section 54). Local disk today, one function
 * to swap for production:
 *   - Supabase Storage (free tier, S3-compatible) or Cloudflare R2 (free
 *     tier) both work with the same interface — replace the body of
 *     `saveFile`/`readStoredFile` with their SDK calls and keep the
 *     `files` table exactly as is. Nothing else in the app touches disk
 *     paths directly; every read goes through `getSignedFileUrl`.
 */
const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/vnd.dwg",
  "application/acad",
  "application/dwg",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
]);

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

// Minimal magic-byte signature check (section 55: validate MIME + file signature).
const SIGNATURES: { mime: string; bytes: number[] }[] = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
];

export function looksLikeDeclaredType(buffer: Buffer, mimeType: string): boolean {
  const sig = SIGNATURES.find((s) => s.mime === mimeType);
  if (!sig) return true; // no signature on file for this type (e.g. office docs are zip containers) — skip
  return sig.bytes.every((b, i) => buffer[i] === b);
}

export async function saveFile(opts: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  kind: "photo" | "document" | "voice" | "drawing" | "other";
  visibility?: "internal" | "project_team" | "client_visible" | "approved";
  uploadedBy: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}) {
  if (!ALLOWED_MIME_TYPES.has(opts.mimeType)) {
    throw new Error("This file type is not supported.");
  }
  if (opts.buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error("This file is too large (25MB limit).");
  }
  if (!looksLikeDeclaredType(opts.buffer, opts.mimeType)) {
    throw new Error("This file's contents don't match its declared type.");
  }

  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}/${randomUUID()}-${sanitizeFilename(opts.originalName)}`;
  const fullPath = path.join(UPLOAD_ROOT, key);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, opts.buffer);

  const [row] = await db
    .insert(filesTable)
    .values({
      originalName: opts.originalName,
      storageKey: key,
      mimeType: opts.mimeType,
      sizeBytes: opts.buffer.byteLength,
      kind: opts.kind,
      visibility: opts.visibility ?? "internal",
      uploadedBy: opts.uploadedBy,
      relatedEntityType: opts.relatedEntityType,
      relatedEntityId: opts.relatedEntityId,
    })
    .returning();
  return row;
}

export async function readStoredFile(storageKey: string) {
  return readFile(path.join(UPLOAD_ROOT, storageKey));
}

export async function getFileById(id: string) {
  return db.query.files.findFirst({ where: eq(filesTable.id, id) });
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-100);
}
