"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { chatParticipants, chatMessages, notifications } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { saveFile } from "@/lib/storage";
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
  const file = formData.get("file") as File | null;
  const voiceFile = formData.get("voice") as File | null;
  const transcript = formData.get("transcript") as string | null;
  const durationRaw = formData.get("duration") as string | null;

  let fileId: string | undefined;
  let voiceNoteId: string | undefined;

  if (type === "voice" && voiceFile && voiceFile.size > 0) {
    const note = await saveVoiceNote({ file: voiceFile, transcript, durationSeconds: durationRaw ? Number(durationRaw) : null, recordedBy: actor.id });
    voiceNoteId = note.id;
  } else if ((type === "photo" || type === "document") && file && file.size > 0) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveFile({
      buffer,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
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

export async function markConversationRead(conversationId: string) {
  const actor = await requireUser();
  await db
    .update(chatParticipants)
    .set({ lastReadAt: new Date() })
    .where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.userId, actor.id)));
}
