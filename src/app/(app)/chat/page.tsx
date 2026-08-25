import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { chatConversations, chatParticipants, chatMessages, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getOrCreateTeamConversation } from "@/lib/chat";
import { PageHeader, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo } from "@/lib/format";
import { NewDmPicker } from "./new-dm-picker";

export default async function ChatListPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const team = await getOrCreateTeamConversation(user.id);

  const myMemberships = await db.select().from(chatParticipants).where(eq(chatParticipants.userId, user.id));
  const dmMemberships = myMemberships.filter((m) => m.conversationId !== team.id);

  type Row = { id: string; label: string; lastMessageAt: Date | null; preview: string | null; unread: boolean };
  const rows: Row[] = [];

  for (const membership of [{ conversationId: team.id, lastReadAt: myMemberships.find((m) => m.conversationId === team.id)?.lastReadAt ?? null }, ...dmMemberships]) {
    const convo = await db.query.chatConversations.findFirst({ where: eq(chatConversations.id, membership.conversationId) });
    if (!convo) continue;

    let label = convo.name ?? "Team";
    if (convo.type === "dm") {
      const other = await db
        .select({ userId: chatParticipants.userId })
        .from(chatParticipants)
        .where(and(eq(chatParticipants.conversationId, convo.id), ne(chatParticipants.userId, user.id)));
      const otherUser = other[0] ? await db.query.users.findFirst({ where: eq(users.id, other[0].userId) }) : null;
      label = otherUser?.name ?? "Direct message";
    }

    const lastMessage = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, convo.id))
      .orderBy(desc(chatMessages.createdAt))
      .limit(1);
    const last = lastMessage[0];
    const preview = last ? (last.type === "text" ? last.text_ : last.type === "photo" ? "📷 Photo" : last.type === "document" ? "📄 Document" : "🎙 Voice note") : null;
    const unread = !!last && (!membership.lastReadAt || new Date(last.createdAt) > new Date(membership.lastReadAt)) && last.senderId !== user.id;

    rows.push({ id: convo.id, label, lastMessageAt: last?.createdAt ?? convo.createdAt, preview, unread });
  }

  rows.sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));

  const coworkers = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.status, "active"), ne(users.id, user.id)));

  return (
    <div>
      <PageHeader title="Chat" subtitle="Message anyone on the team, or the whole studio at once." />

      <div className="mb-4">
        <NewDmPicker coworkers={coworkers} />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="message" title="No conversations yet" />
      ) : (
        <div className="card divide-y divide-border">
          {rows.map((r) => (
            <Link key={r.id} href={`/chat/${r.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-background">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${r.unread ? "bg-accent text-white" : "bg-slate-100 text-slate-500"}`}>
                {r.label === "Team" ? <Icon name="users" className="h-4 w-4" /> : r.label[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${r.unread ? "font-semibold" : "font-medium"}`}>{r.label}</span>
                  {r.lastMessageAt && <span className="shrink-0 text-[11px] text-muted">{timeAgo(r.lastMessageAt)}</span>}
                </div>
                <p className={`truncate text-xs ${r.unread ? "text-foreground" : "text-muted"}`}>{r.preview ?? "No messages yet — say hi."}</p>
              </div>
              {r.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
