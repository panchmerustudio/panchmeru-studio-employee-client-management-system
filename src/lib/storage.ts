import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
  // Recent AWS SDK versions default to WHEN_SUPPORTED, which auto-attaches
  // an x-amz-checksum-crc32 param to presigned PutObject URLs. R2 doesn't
  // always play well with that (a frequent cause of a presigned PUT that
  // hangs or gets blocked before R2 ever returns a response, showing up in
  // the browser as a bare "Failed to fetch"), so opt back into the old
  // behavior: only add a checksum when a command explicitly asks for one.
  requestChecksumCalculation: "WHEN_REQUIRED",
});
const BUCKET = process.env.R2_BUCKET_NAME ?? "";

// Fail loudly and clearly if R2 isn't configured, instead of letting the
// AWS SDK throw its own cryptic error ("No value provided for input HTTP
// label: Bucket.") deep inside a PutObjectCommand/HeadObjectCommand call.
// Every exported function below that talks to R2 calls this first.
function assertR2Configured() {
  const missing = [
    !process.env.R2_ACCOUNT_ID && "R2_ACCOUNT_ID",
    !process.env.R2_ACCESS_KEY_ID && "R2_ACCESS_KEY_ID",
    !process.env.R2_SECRET_ACCESS_KEY && "R2_SECRET_ACCESS_KEY",
    !process.env.R2_BUCKET_NAME && "R2_BUCKET_NAME",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `File storage isn't configured on the server (missing: ${missing.join(", ")}). Set these in Vercel → Settings → Environment Variables, then redeploy — adding/editing env vars doesn't affect deployments already running.`
    );
  }
}

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

// Was 25MB, which never actually worked once this app moved to Vercel:
// Vercel hard-caps every Function's request body (Server Actions and API
// routes alike) at 4.5MB on every plan, with no config to raise it. 4MB
// here matches next.config.ts's serverActions.bodySizeLimit and leaves a
// little headroom under Vercel's real ceiling. This only bounds `saveFile`
// (the path where bytes travel through the app's own server) — uploads
// that go through `createPresignedUpload`/`registerUploadedFile` below
// bypass Vercel's server entirely and use MAX_DIRECT_UPLOAD_BYTES instead.
export const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024; // 4MB

// The real ceiling for direct browser-to-R2 uploads (see below) — not
// constrained by Vercel at all, so this is a product choice, not a
// platform one. 50MB comfortably covers a large architectural PDF set or
// a complex DXF; raise it if that's ever not enough.
export const MAX_DIRECT_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB

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
  assertR2Configured();
  if (!ALLOWED_MIME_TYPES.has(opts.mimeType)) {
    throw new Error("This file type is not supported.");
  }
  if (opts.buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error("This file is too large (4MB limit).");
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

/**
 * Direct-to-R2 upload, part 1: hand the browser a short-lived, scoped URL
 * it can PUT the file bytes to directly — the file never passes through
 * this app's own server, so it isn't subject to Vercel's 4.5MB request
 * body limit (see MAX_FILE_SIZE_BYTES above). Call this from a small,
 * auth-checked API route (see /api/uploads/presign), not directly from
 * client code — it needs the R2 credentials, which stay server-only.
 */
export async function createPresignedUpload(opts: { mimeType: string; originalName: string; sizeBytes: number }) {
  assertR2Configured();
  if (!ALLOWED_MIME_TYPES.has(opts.mimeType)) {
    throw new Error("This file type is not supported.");
  }
  if (opts.sizeBytes > MAX_DIRECT_UPLOAD_BYTES) {
    throw new Error(`This file is too large (${Math.round(MAX_DIRECT_UPLOAD_BYTES / (1024 * 1024))}MB limit).`);
  }
  if (opts.sizeBytes <= 0) {
    throw new Error("That file looks empty.");
  }

  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}/${randomUUID()}-${sanitizeFilename(opts.originalName)}`;
  const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: opts.mimeType }), { expiresIn: 300 });
  return { uploadUrl, key };
}

/**
 * Short-lived, read-only URL for an object already in R2 — for handing to
 * a *trusted third-party service* (currently: CloudConvert, to fetch a DWG
 * for conversion — see src/lib/cloudconvert.ts) that needs to read the file
 * itself rather than going through this app. The bucket is otherwise never
 * public (see the module doc above), so keep the expiry short and only
 * call this for a specific, known integration — never expose the URL this
 * returns directly to the browser.
 */
export async function createPresignedDownload(key: string, expiresInSeconds = 600) {
  assertR2Configured();
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: expiresInSeconds });
}

/**
 * Direct-to-R2 upload, part 2: once the browser's PUT to the presigned
 * URL above succeeds, call this (through a normal server action — it's a
 * tiny JSON payload, well under any body limit) to create the `files` row
 * pointing at the object that's already sitting in R2. Re-checks the
 * object actually exists and re-reads its real size/type from R2 with
 * HeadObjectCommand rather than trusting whatever the client claims, so a
 * caller can't register a row for an object that was never uploaded or
 * lie about its size.
 */
export async function registerUploadedFile(opts: {
  key: string;
  originalName: string;
  mimeType: string;
  kind: "photo" | "document" | "voice" | "drawing" | "other";
  visibility?: "internal" | "project_team" | "client_visible" | "approved";
  uploadedBy?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}) {
  assertR2Configured();
  if (!ALLOWED_MIME_TYPES.has(opts.mimeType)) {
    throw new Error("This file type is not supported.");
  }

  let head;
  try {
    head = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: opts.key }));
  } catch {
    throw new Error("That upload didn't complete — please try again.");
  }
  const actualSize = head.ContentLength ?? 0;
  if (actualSize <= 0 || actualSize > MAX_DIRECT_UPLOAD_BYTES) {
    throw new Error("That upload didn't complete — please try again.");
  }

  const [row] = await db
    .insert(filesTable)
    .values({
      originalName: opts.originalName,
      storageKey: opts.key,
      mimeType: opts.mimeType,
      sizeBytes: actualSize,
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
  assertR2Configured();
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: storageKey }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error("Could not read stored file.");
  return Buffer.from(bytes);
}

export async function deleteStoredFile(storageKey: string) {
  assertR2Configured();
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
}

export async function getFileById(id: string) {
  return db.query.files.findFirst({ where: eq(filesTable.id, id) });
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-100);
}
