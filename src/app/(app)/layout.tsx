import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db/client";
import { notifications } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { primaryNavFor, secondaryNavFor } from "@/lib/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const unread = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.recipientId, user.id), isNull(notifications.readAt)));

  return (
    <AppShell
      primary={primaryNavFor(user.roleKey)}
      secondary={secondaryNavFor(user.roleKey)}
      userName={user.name}
      roleName={user.roleName}
      unreadCount={unread.length}
    >
      {children}
    </AppShell>
  );
}
