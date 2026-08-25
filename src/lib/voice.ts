import "server-only";
import { db } from "@/db/client";
import { voiceNotes } from "@/db/schema";
import { saveFile } from "./storage";

/** Saves an uploaded voice-note Blob (from VoiceRecorder) as a file + voice_notes row. */
export async function saveVoiceNote(opts: { file: File; transcript: string | null; durationSeconds: number | null; recordedBy: string }) {
  const buffer = Buffer.from(await opts.file.arrayBuffer());
  const saved = await saveFile({
    buffer,
    originalName: opts.file.name || "voice-note.webm",
    mimeType: opts.file.type || "audio/webm",
    kind: "voice",
    uploadedBy: opts.recordedBy,
  });
  const [note] = await db
    .insert(voiceNotes)
    .values({
      audioFileId: saved.id,
      transcript: opts.transcript,
      transcriptionStatus: opts.transcript ? "done" : "none",
      durationSeconds: opts.durationSeconds ?? undefined,
      recordedBy: opts.recordedBy,
    })
    .returning();
  return note;
}
