import "server-only";
import { db } from "@/db/client";
import { chatConversations, chatParticipants, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * The single always-on staff-wide conversation ("chat facility between
 * all employees"). Created lazily on first use rather than at seed time
 * so it always includes every currently-active user, including anyone
 * added after the team conversation was first created.
 */
export async function getOrCreateTeamConversation(currentUserId: string) {
  let convo = await db.query.chatConversations.findFirst({ where: eq(chatConversations.type, "team") });
  if (!convo) {
    const [created] = await db.insert(chatConversations).values({ type: "team", name: "Team", createdBy: currentUserId }).returning();
    convo = created;
    const activeUsers = await db.select({ id: users.id }).from(users).where(eq(users.status, "active"));
    if (activeUsers.length) {
      await db.insert(chatParticipants).values(activeUsers.map((u) => ({ conversationId: convo!.id, userId: u.id })));
    }
    return convo;
  }
  const alreadyIn = await db.query.chatParticipants.findFirst({
    where: and(eq(chatParticipants.conversationId, convo.id), eq(chatParticipants.userId, currentUserId)),
  });
  if (!alreadyIn) {
    await db.insert(chatParticipants).values({ conversationId: convo.id, userId: currentUserId });
  }
  return convo;
}

/** Finds (or starts) the 1:1 conversation between exactly these two users. */
export async function getOrCreateDm(userAId: string, userBId: string) {
  const aConvoIds = await db.select({ conversationId: chatParticipants.conversationId }).from(chatParticipants).where(eq(chatParticipants.userId, userAId));

  for (const { conversationId } of aConvoIds) {
    const convo = await db.query.chatConversations.findFirst({
      where: and(eq(chatConversations.id, conversationId), eq(chatConversations.type, "dm")),
    });
    if (!convo) continue;
    const participants = await db.select({ userId: chatParticipants.userId }).from(chatParticipants).where(eq(chatParticipants.conversationId, conversationId));
    const ids = participants.map((p) => p.userId);
    if (ids.length === 2 && ids.includes(userAId) && ids.includes(userBId)) return convo;
  }

  const [convo] = await db.insert(chatConversations).values({ type: "dm", createdBy: userAId }).returning();
  await db.insert(chatParticipants).values([
    { conversationId: convo.id, userId: userAId },
    { conversationId: convo.id, userId: userBId },
  ]);
  return convo;
}
