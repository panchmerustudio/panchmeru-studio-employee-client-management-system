import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { notificationHref } from "@/lib/notification-link";
import { markAllRead, markRead } from "./actions";
import { Icon } from "@/components/icon";

export default async function NotificationsPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const rows = await db.select().from(notifications).where(eq(notifications.recipientId, user.id)).orderBy(desc(notifications.createdAt)).limit(50);
  const unreadCount = rows.filter((r) => !r.readAt).length;

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
        action={
          unreadCount > 0 && (
            <form action={markAllRead}>
              <button type="submit" className="btn btn-secondary">Mark all read</button>
            </form>
          )
        }
      />

      {rows.length === 0 ? (
        <EmptyState icon="bell" title="No notifications yet" />
      ) : (
        <div className="card divide-y divide-border">
          {rows.map((n) => {
            const href = notificationHref(n.relatedEntityType, n.relatedEntityId);
            const content = (
              <div className={`flex items-start gap-3 px-4 py-3.5 ${!n.readAt ? "bg-amber-50/50" : ""}`}>
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${!n.readAt ? "bg-accent text-white" : "bg-slate-100 text-slate-400"}`}>
                  <Icon name="bell" className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">{n.title}</div>
                  <div className="text-xs text-muted">{n.message}</div>
                  <div className="mt-0.5 text-[11px] text-muted">{timeAgo(n.createdAt)}</div>
                </div>
              </div>
            );
            return href ? (
              <Link key={n.id} href={href} onClick={markRead.bind(null, n.id)} className="block hover:bg-background">
                {content}
              </Link>
            ) : (
              <div key={n.id}>{content}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
