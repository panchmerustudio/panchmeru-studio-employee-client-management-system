import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { idColumn, createdAtOnly } from "./common";
import { users } from "./identity";

/**
 * Generic file metadata table (section 54/55 of the spec). The actual bytes
 * live in object storage (local disk under /uploads in dev; swap to S3 /
 * Supabase Storage / Cloudflare R2 in production — see lib/storage.ts,
 * which is the single seam that needs to change). This table never stores
 * file contents, only metadata + a storage key, and access is always
 * brokered through a signed/short-lived URL (see /api/files/[id]).
 */
export const files = pgTable("files", {
  id: idColumn(),
  originalName: text("original_name").notNull(),
  storageKey: text("storage_key").notNull(), // relative path / object key
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  kind: text("kind", {
    enum: ["photo", "document", "voice", "drawing", "other"],
  }).notNull(),
  visibility: text("visibility", {
    enum: ["internal", "project_team", "client_visible", "approved"],
  })
    .notNull()
    .default("internal"),
  // Loose polymorphic association so one table can back attachments across
  // tasks, sites, documents, employees, leave, materials, etc. Kept
  // alongside (not instead of) the strongly-typed FK join tables below,
  // for cases that just need "a file attached to X".
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: text("related_entity_id"),
  uploadedBy: text("uploaded_by")
    .notNull()
    .references(() => users.id),
  ...createdAtOnly(),
});

/** Voice note: always retains the original audio + (optional) transcript. */
export const voiceNotes = pgTable("voice_notes", {
  id: idColumn(),
  audioFileId: text("audio_file_id")
    .notNull()
    .references(() => files.id),
  transcript: text("transcript"),
  transcriptionStatus: text("transcription_status", {
    enum: ["none", "pending", "done", "failed"],
  })
    .notNull()
    .default("none"),
  durationSeconds: integer("duration_seconds"),
  recordedBy: text("recorded_by")
    .notNull()
    .references(() => users.id),
  ...createdAtOnly(),
});
