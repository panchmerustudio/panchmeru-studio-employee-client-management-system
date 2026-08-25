import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveRequests, notifications } from "@/db/schema";
import { hasPermission, requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState } from "@/components/ui";
import { markAllRead } from "./actions";
import { NotificationRow } from "./notification-row";

export default async function NotificationsPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const rows = await db.select().from(notifications).where(eq(notifications.recipientId, user.id)).orderBy(desc(notifications.createdAt)).limit(50);
  const unreadCount = rows.filter((r) => !r.readAt).length;

  // Leave-request notifications get inline Approve/Reject controls (see NotificationRow) when the
  // recipient can approve leave AND the request is still pending — someone else may already have
  // decided it since this notification landed.
  const canApproveLeave = hasPermission(user, PERMISSIONS.LEAVE_APPROVE);
  const leaveRequestIds = [...new Set(rows.filter((r) => r.type === "leave_requested" && r.relatedEntityId).map((r) => r.relatedEntityId as string))];
  const pendingLeaveIds =
    canApproveLeave && leaveRequestIds.length > 0
      ? new Set(
          (
            await db
              .select({ id: leaveRequests.id })
              .from(leaveRequests)
              .where(and(inArray(leaveRequests.id, leaveRequestIds), eq(leaveRequests.status, "pending")))
          ).map((r) => r.id)
        )
      : new Set<string>();

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
        action={
          unreadCount > 0 && (
            <form action={markAllRead}>
              <button type="submit" className="btn btn-secondary">
                Mark all read
              </button>
            </form>
          )
        }
      />

      {rows.length === 0 ? (
        <EmptyState icon="bell" title="No notifications yet" />
      ) : (
        <div className="card divide-y divide-border">
          {rows.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              canDecideLeave={canApproveLeave && n.type === "leave_requested" && !!n.relatedEntityId && pendingLeaveIds.has(n.relatedEntityId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
