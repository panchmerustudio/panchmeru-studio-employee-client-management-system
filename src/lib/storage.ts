import "server-only";
import { put, del } from "@vercel/blob";
import { randomUUID } from "crypto";
import { db } from "@/db/client";
import { files as filesTable } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Object storage seam (spec section 54). Backed by Vercel Blob — needs the
 * project's Blob store connected in Vercel (Storage tab -> Create Database
 * -> Blob -> Connect to Project), which auto-sets BLOB_READ_WRITE_TOKEN.
 * This used to write to local disk under /uploads, which worked in dev but
 * silently failed on Vercel (its filesystem is read-only at runtime except
 * /tmp, and /tmp doesn't survive between requests) — that was the actual
 * cause of "upload/voice note doesn't work" once deployed. Nothing else in
 * the app touches storage directly; every write goes through `saveFile`
 * and every read through `readStoredFile` / `/api/files/[id]`, so this is
 * the only file that needed to change.
 *
 * Blobs are stored with `access: "public"` (Vercel Blob's only mode today)
 * under an unguessable random pathname — but that pathname is never sent
 * to the browser. The client only ever calls `/api/files/[id]`, which
 * checks the caller is signed in, then fetches the blob server-side and
 * streams it back — the same privacy boundary the local-disk version had.
 */
const BLOB_PREFIX = "panchmeru";

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
  const key = `${BLOB_PREFIX}/${day}/${randomUUID()}-${sanitizeFilename(opts.originalName)}`;
  const blob = await put(key, opts.buffer, {
    access: "public",
    contentType: opts.mimeType,
    addRandomSuffix: false,
  });

  const [row] = await db
    .insert(filesTable)
    .values({
      originalName: opts.originalName,
      storageKey: blob.url,
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
  const res = await fetch(storageKey);
  if (!res.ok) throw new Error(`Could not read stored file (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteStoredFile(storageKey: string) {
  await del(storageKey);
}

export async function getFileById(id: string) {
  return db.query.files.findFirst({ where: eq(filesTable.id, id) });
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-100);
}
