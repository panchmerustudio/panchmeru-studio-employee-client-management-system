import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, createdAtOnly } from "./common";
import { users } from "./identity";
import { files } from "./files";

/**
 * Internal staff chat — "chat facility between all employees or with
 * owner". A conversation is either the single always-on "team" group
 * (every active user is a participant, created on first use) or a "dm"
 * between exactly two users. Deliberately separate from the task/site
 * "Conversation" threads (taskComments etc.), which stay scoped to their
 * task/site. Client-facing chat is future work (see clientMessages in
 * future-client.ts) and would reuse this same shape once Client
 * Management is switched on.
 */
export const chatConversations = pgTable("chat_conversations", {
  id: idColumn(),
  type: text("type", { enum: ["team", "dm"] }).notNull(),
  name: text("name"), // only set for "team"
  createdBy: text("created_by").references(() => users.id),
  ...createdAtOnly(),
});

export const chatParticipants = pgTable("chat_participants", {
  id: idColumn(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => chatConversations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at"),
  ...createdAtOnly(),
});

export const chatMessages = pgTable("chat_messages", {
  id: idColumn(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => chatConversations.id, { onDelete: "cascade" }),
  senderId: text("sender_id")
    .notNull()
    .references(() => users.id),
  type: text("type", { enum: ["text", "photo", "document", "voice"] })
    .notNull()
    .default("text"),
  text_: text("text"),
  fileId: text("file_id").references(() => files.id),
  voiceNoteId: text("voice_note_id"),
  ...createdAtOnly(),
});
