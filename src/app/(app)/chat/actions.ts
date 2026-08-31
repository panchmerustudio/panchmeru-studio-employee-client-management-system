"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { chatParticipants, chatMessages, files as filesTable, notifications, voiceNotes } from "@/db/schema";
import { hasPermission, requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { deleteStoredFile, registerUploadedFile } from "@/lib/storage";
import { saveVoiceNote } from "@/lib/voice";
import { getOrCreateTeamConversation, getOrCreateDm } from "@/lib/chat";

/** Ensures the team conversation exists (and the caller is in it), returns its id. */
export async function openTeamChat(): Promise<{ id: string }> {
  const actor = await requireUser();
  const convo = await getOrCreateTeamConversation(actor.id);
  return { id: convo.id };
}

/** Finds or starts a 1:1 conversation with another user, returns its id. */
export async function startDm(otherUserId: string): Promise<{ id: string }> {
  const actor = await requireUser();
  if (otherUserId === actor.id) throw new Error("You can't message yourself.");
  const convo = await getOrCreateDm(actor.id, otherUserId);
  return { id: convo.id };
}

export async function sendMessage(conversationId: string, formData: FormData) {
  const actor = await requireUser();

  const participant = await db.query.chatParticipants.findFirst({
    where: and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.userId, actor.id)),
  });
  if (!participant) throw new Error("You're not part of this conversation.");

  const type = String(formData.get("type") || "text") as "text" | "voice" | "photo" | "document";
  const text = formData.get("text") as string | null;
  const fileKey = formData.get("fileKey") as string | null;
  const fileMimeType = formData.get("fileMimeType") as string | null;
  const fileOriginalName = formData.get("fileOriginalName") as string | null;
  const voiceFile = formData.get("voice") as File | null;
  const transcript = formData.get("transcript") as string | null;
  const durationRaw = formData.get("duration") as string | null;

  let fileId: string | undefined;
  let voiceNoteId: string | undefined;

  if (type === "voice" && voiceFile && voiceFile.size > 0) {
    const note = await saveVoiceNote({ file: voiceFile, transcript, durationSeconds: durationRaw ? Number(durationRaw) : null, recordedBy: actor.id });
    voiceNoteId = note.id;
  } else if ((type === "photo" || type === "document") && fileKey && fileMimeType && fileOriginalName) {
    const saved = await registerUploadedFile({
      key: fileKey,
      originalName: fileOriginalName,
      mimeType: fileMimeType,
      kind: type === "photo" ? "photo" : "document",
      uploadedBy: actor.id,
      relatedEntityType: "chat_conversation",
      relatedEntityId: conversationId,
    });
    fileId = saved.id;
  } else if (type === "text" && !text?.trim()) {
    throw new Error("Write a message first.");
  }

  await db.insert(chatMessages).values({ conversationId, senderId: actor.id, type, text_: text || null, fileId, voiceNoteId });
  await db
    .update(chatParticipants)
    .set({ lastReadAt: new Date() })
    .where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.userId, actor.id)));

  const others = await db
    .select({ userId: chatParticipants.userId })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.conversationId, conversationId), ne(chatParticipants.userId, actor.id)));

  if (others.length) {
    const preview = type === "text" ? (text || "").slice(0, 140) : type === "photo" ? "Sent a photo" : type === "document" ? "Sent a document" : "Sent a voice note";
    await db.insert(notifications).values(
      others.map((o) => ({
        recipientId: o.userId,
        type: "chat_message",
        title: `New message from ${actor.name}`,
        message: preview,
        relatedEntityType: "chat_conversation",
        relatedEntityId: conversationId,
      }))
    );
  }

  revalidatePath(`/chat/${conversationId}`);
  revalidatePath("/chat");
}

/**
 * Lets a message's sender (or an owner, for moderation) delete it and
 * anything it carries — the user asked for messages to be "keep forever
 * or delete, your choice" rather than everything being permanent by
 * default. Same DB-first, R2-second order as file deletion elsewhere:
 * the chat_messages row goes first (that's what frees the FK on
 * chat_messages.fileId), then the file/voice-note rows, then the actual
 * object in R2 — so nothing in R2 is ever removed while something still
 * references it.
 */
export async function deleteMessage(messageId: string) {
  const actor = await requireUser();

  const message = await db.query.chatMessages.findFirst({ where: eq(chatMessages.id, messageId) });
  if (!message) throw new Error("Message not found — it may already be deleted.");

  const canDelete = message.senderId === actor.id || hasPermission(actor, PERMISSIONS.SETTINGS_MANAGE);
  if (!canDelete) throw new Error("You can only delete your own messages.");

  await db.delete(chatMessages).where(eq(chatMessages.id, messageId));

  if (message.fileId) {
    const file = await db.query.files.findFirst({ where: eq(filesTable.id, message.fileId) });
    if (file) {
      await db.delete(filesTable).where(eq(filesTable.id, file.id));
      await deleteStoredFile(file.storageKey).catch((err) =>
        console.error(`Failed to delete R2 object for chat file ${file.id} (storageKey: ${file.storageKey}):`, err)
      );
    }
  }

  if (message.voiceNoteId) {
    const note = await db.query.voiceNotes.findFirst({ where: eq(voiceNotes.id, message.voiceNoteId) });
    if (note) {
      await db.delete(voiceNotes).where(eq(voiceNotes.id, note.id));
      const file = await db.query.files.findFirst({ where: eq(filesTable.id, note.audioFileId) });
      if (file) {
        await db.delete(filesTable).where(eq(filesTable.id, file.id));
        await deleteStoredFile(file.storageKey).catch((err) =>
          console.error(`Failed to delete R2 object for voice note ${file.id} (storageKey: ${file.storageKey}):`, err)
        );
      }
    }
  }

  await recordAudit({
    actor,
    action: "chat_message.deleted",
    entityType: "chat_message",
    entityId: messageId,
    previousState: { conversationId: message.conversationId, type: message.type, senderId: message.senderId },
  });

  revalidatePath(`/chat/${message.conversationId}`);
  revalidatePath("/chat");
}

export async function markConversationRead(conversationId: string) {
  const actor = await requireUser();
  await db
    .update(chatParticipants)
    .set({ lastReadAt: new Date() })
    .where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.userId, actor.id)));
}
