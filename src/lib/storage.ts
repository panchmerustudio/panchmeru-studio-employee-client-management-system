import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { db } from "@/db/client";
import { files as filesTable } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Object storage seam (spec section 54). Backed by Cloudflare R2 (S3-
 * compatible, and the only one of the free options with no bandwidth cap —
 * see README) via four env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.
 *
 * This used to write to local disk under /uploads, which worked in dev but
 * silently failed on Vercel (its filesystem is read-only at runtime except
 * /tmp, and /tmp doesn't survive between requests) — that was the actual
 * cause of "upload/voice note doesn't work" once deployed. Nothing else in
 * the app touches storage directly; every write goes through `saveFile`
 * and every read through `readStoredFile` / `/api/files/[id]`, so this is
 * the only file that needed to change.
 *
 * The R2 bucket is never made public — every read goes through
 * `readStoredFile`, called only from `/api/files/[id]`, which checks the
 * caller is signed in before streaming the object back. The object key
 * (storageKey) is never sent to the browser.
 */
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});
const BUCKET = process.env.R2_BUCKET_NAME ?? "";

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
  "application/dxf",
  "image/vnd.dxf",
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
  // Optional: unset for anonymous uploads (the public /apply page has no signed-in user to attribute a resume to).
  uploadedBy?: string;
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
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: opts.buffer,
      ContentType: opts.mimeType,
    })
  );

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
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: storageKey }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error("Could not read stored file.");
  return Buffer.from(bytes);
}

export async function deleteStoredFile(storageKey: string) {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
}

export async function getFileById(id: string) {
  return db.query.files.findFirst({ where: eq(filesTable.id, id) });
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-100);
}
