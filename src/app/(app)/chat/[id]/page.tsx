import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { chatConversations, chatParticipants, chatMessages, users, voiceNotes, files as filesTable } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PageHeader, SectionCard } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo } from "@/lib/format";
import { markConversationRead } from "../actions";
import { ChatComposer } from "./composer";

export default async function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const convo = await db.query.chatConversations.findFirst({ where: eq(chatConversations.id, id) });
  if (!convo) notFound();

  const membership = await db.query.chatParticipants.findFirst({
    where: and(eq(chatParticipants.conversationId, id), eq(chatParticipants.userId, user.id)),
  });
  if (!membership) notFound();

  await markConversationRead(id);

  let title = convo.name ?? "Team";
  if (convo.type === "dm") {
    const other = await db
      .select({ userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(and(eq(chatParticipants.conversationId, id), ne(chatParticipants.userId, user.id)));
    const otherUser = other[0] ? await db.query.users.findFirst({ where: eq(users.id, other[0].userId) }) : null;
    title = otherUser?.name ?? "Direct message";
  }

  const messages = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, id)).orderBy(asc(chatMessages.createdAt));
  const authors = await Promise.all(messages.map((m) => db.query.users.findFirst({ where: eq(users.id, m.senderId) })));
  const msgVoiceNotes = await Promise.all(messages.map((m) => (m.voiceNoteId ? db.query.voiceNotes.findFirst({ where: eq(voiceNotes.id, m.voiceNoteId) }) : null)));
  const msgFiles = await Promise.all(messages.map((m) => (m.fileId ? db.query.files.findFirst({ where: eq(filesTable.id, m.fileId) }) : null)));

  return (
    <div>
      <PageHeader
        title={title}
        action={
          <Link href="/chat" className="btn btn-secondary">
            <Icon name="arrow-left" className="h-4 w-4" /> Back
          </Link>
        }
      />

      <SectionCard>
        <div className="space-y-3">
          {messages.length === 0 && <p className="text-sm text-muted">No messages yet — say hi.</p>}
          {messages.map((m, i) => {
            const mine = m.senderId === user.id;
            return (
              <div key={m.id} className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold">
                  {authors[i]?.name?.[0] ?? "?"}
                </div>
                <div className={`max-w-[80%] flex-1 rounded-lg px-3 py-2 ${mine ? "bg-brand-ink text-white" : "bg-background"}`}>
                  <div className={`mb-0.5 flex items-center gap-2 ${mine ? "justify-end" : "justify-between"}`}>
                    {!mine && <span className="text-xs font-semibold">{authors[i]?.name}</span>}
                    <span className={`text-[10px] ${mine ? "text-white/70" : "text-muted"}`}>{timeAgo(m.createdAt)}</span>
                  </div>
                  {m.type === "text" && <p className="text-sm">{m.text_}</p>}
                  {m.type === "photo" && msgFiles[i] && (
                    <a href={`/api/files/${m.fileId}`} target="_blank" rel="noreferrer">
                      <img src={`/api/files/${m.fileId}`} alt="attachment" className="mt-1 max-h-48 rounded-lg border border-border" />
                    </a>
                  )}
                  {m.type === "document" && msgFiles[i] && (
                    <a href={`/api/files/${m.fileId}`} target="_blank" rel="noreferrer" className={`mt-1 flex items-center gap-1.5 text-sm font-medium ${mine ? "text-white" : "text-accent"}`}>
                      <Icon name="file" className="h-4 w-4" /> {msgFiles[i]?.originalName}
                    </a>
                  )}
                  {m.type === "voice" && msgVoiceNotes[i] && (
                    <div className="mt-1">
                      <audio controls src={`/api/files/${msgVoiceNotes[i]?.audioFileId}`} className="h-9 w-full max-w-xs" />
                      {msgVoiceNotes[i]?.transcript && <p className="mt-1 text-xs italic opacity-80">&quot;{msgVoiceNotes[i]?.transcript}&quot;</p>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <ChatComposer conversationId={id} />
      </SectionCard>
    </div>
  );
}
