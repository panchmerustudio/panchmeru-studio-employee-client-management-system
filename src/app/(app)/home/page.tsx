import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks, sites, leaveRequests } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PageHeader, SectionCard, Badge, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { Icon } from "@/components/icon";

export default async function HomePage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (user.roleKey === "owner" || user.roleKey === "manager") redirect("/dashboard");
  if (!user.employeeId) {
    return (
      <div>
        <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} />
        <EmptyState icon="user" title="No employee profile linked" subtitle="Ask your manager to link your account to an employee profile." />
      </div>
    );
  }

  const myTasks = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate, siteName: sites.name, priority: tasks.priority })
    .from(tasks)
    .leftJoin(sites, eq(sites.id, tasks.siteId))
    .where(and(eq(tasks.assignedToId, user.employeeId), ne(tasks.status, "cancelled"), ne(tasks.status, "approved")))
    .limit(8);

  const pendingLeave = await db.query.leaveRequests.findFirst({
    where: and(eq(leaveRequests.employeeId, user.employeeId), eq(leaveRequests.status, "pending")),
  });

  return (
    <div className="space-y-6">
      <PageHeader title={`Hi, ${user.name.split(" ")[0]}`} subtitle={formatDate(new Date())} />

      <Link href="/attendance" className="card flex items-center justify-between p-4 hover:bg-background">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-ink text-white">
            <Icon name="clock" className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">Attendance</div>
            <div className="text-xs text-muted">Check in / check out</div>
          </div>
        </div>
        <Icon name="check" className="h-4 w-4 text-muted" />
      </Link>

      <SectionCard title="Your tasks" action={<Link href="/tasks" className="text-xs font-medium text-accent">View all</Link>}>
        {myTasks.length === 0 ? (
          <p className="text-sm text-muted">Nothing assigned right now. 🎉</p>
        ) : (
          <ul className="divide-y divide-border">
            {myTasks.map((t) => (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`} className="flex items-center justify-between py-2.5 text-sm hover:opacity-80">
                  <div>
                    <div className="font-medium text-foreground">{t.title}</div>
                    <div className="text-xs text-muted">{t.siteName ?? "No site"} {t.dueDate ? `· due ${formatDate(t.dueDate)}` : ""}</div>
                  </div>
                  <Badge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/sites" className="card flex flex-col items-center gap-1.5 p-4 text-center hover:bg-background">
          <Icon name="map" className="h-5 w-5 text-brand-ink" />
          <span className="text-sm font-medium">My sites</span>
        </Link>
        <Link href="/leave" className="card flex flex-col items-center gap-1.5 p-4 text-center hover:bg-background">
          <Icon name="calendar" className="h-5 w-5 text-brand-ink" />
          <span className="text-sm font-medium">Apply leave</span>
          {pendingLeave && <span className="text-[10px] text-amber-600">1 pending</span>}
        </Link>
      </div>
    </div>
  );
}
