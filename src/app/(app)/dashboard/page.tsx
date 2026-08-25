import { redirect } from "next/navigation";
import Link from "next/link";
import { eq, and, sql, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, attendanceRecords, tasks, sites, projects, siteVisits, leaveRequests } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, StatCard, SectionCard, Badge, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { checkStorageThresholdAndNotify } from "@/lib/storage-usage";

export default async function DashboardPage() {
  const user = await requirePermission(PERMISSIONS.DASHBOARD_OWNER).catch(() => null);
  if (!user) redirect("/home");

  // Reactive storage check (no Vercel Cron needed) — piggybacks on the
  // owner opening their dashboard so a threshold crossing gets noticed
  // and notified without anyone visiting Settings → Storage directly.
  // Never let this block or break the dashboard.
  checkStorageThresholdAndNotify().catch((err) => console.error("Storage threshold check failed:", err));

  const today = new Date().toISOString().slice(0, 10);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [totalEmployeesRow] = await db.select({ count: sql<number>`count(*)` }).from(employees).where(eq(employees.status, "active"));
  const [presentRow] = await db.select({ count: sql<number>`count(*)` }).from(attendanceRecords).where(and(eq(attendanceRecords.date, today), eq(attendanceRecords.status, "present")));
  const [onLeaveRow] = await db.select({ count: sql<number>`count(*)` }).from(attendanceRecords).where(and(eq(attendanceRecords.date, today), eq(attendanceRecords.status, "on_leave")));
  const [onSiteRow] = await db.select({ count: sql<number>`count(distinct employee_id)` }).from(siteVisits).where(eq(siteVisits.status, "active"));

  const totalEmployees = totalEmployeesRow?.count ?? 0;
  const present = presentRow?.count ?? 0;
  const onLeave = onLeaveRow?.count ?? 0;
  const onSite = onSiteRow?.count ?? 0;
  const absent = Math.max(totalEmployees - present - onLeave, 0);

  const taskCounts = await db.select({ status: tasks.status, count: sql<number>`count(*)` }).from(tasks).groupBy(tasks.status);
  const countFor = (s: string) => taskCounts.find((t) => t.status === s)?.count ?? 0;
  const awaitingApproval = countFor("submitted");
  const modificationRequired = countFor("modification_required");
  const overdue = countFor("overdue");
  const completedToday = countFor("approved");
  const pending = countFor("to_do") + countFor("in_progress");

  const [totalActiveSitesRow] = await db.select({ count: sql<number>`count(*)` }).from(sites).where(eq(sites.status, "active"));
  const [visitsTodayRow] = await db.select({ count: sql<number>`count(*)` }).from(siteVisits).where(gte(siteVisits.startedAt, startOfToday));
  const attentionSites = await db.select().from(sites).where(and(eq(sites.status, "active"), sql`${sites.healthStatus} != 'normal'`));

  const projectCounts = await db.select({ status: projects.status, count: sql<number>`count(*)` }).from(projects).groupBy(projects.status);
  const pCountFor = (s: string) => projectCounts.find((p) => p.status === s)?.count ?? 0;

  const pendingLeaveCount = await db.select({ count: sql<number>`count(*)` }).from(leaveRequests).where(eq(leaveRequests.status, "pending"));

  return (
    <div className="space-y-8">
      <PageHeader title="Studio Dashboard" subtitle={formatDate(new Date())} />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">People</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Total employees" value={totalEmployees} icon="users" href="/employees" />
          <StatCard label="Present today" value={present} icon="check-circle" tone="success" href="/attendance/team" />
          <StatCard label="Absent today" value={absent} icon="x" tone="danger" href="/attendance/team" />
          <StatCard label="On leave" value={onLeave} icon="calendar" tone="warning" href="/leave" />
          <StatCard label="Currently on site" value={onSite} icon="map-pin" href="/sites" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Work</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Pending / in progress" value={pending} icon="check" href="/tasks?status=to_do" />
          <StatCard label="Awaiting approval" value={awaitingApproval} icon="clock" tone="warning" href="/tasks?status=submitted" />
          <StatCard label="Modification required" value={modificationRequired} icon="edit" tone="danger" href="/tasks?status=modification_required" />
          <StatCard label="Overdue" value={overdue} icon="alert" tone="danger" href="/tasks?status=overdue" />
          <StatCard label="Approved" value={completedToday} icon="check-circle" tone="success" href="/tasks?status=approved" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Sites</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Active sites" value={totalActiveSitesRow?.count ?? 0} icon="map" href="/sites" />
          <StatCard label="Visits today" value={visitsTodayRow?.count ?? 0} icon="map-pin" href="/sites" />
          <StatCard label="Need attention" value={attentionSites.length} icon="alert" tone="warning" href="/sites?health=attention" />
          <StatCard label="Pending leave requests" value={pendingLeaveCount[0]?.count ?? 0} icon="calendar" tone="warning" href="/leave" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Projects</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Active" value={pCountFor("active")} icon="folder" tone="success" href="/projects" />
          <StatCard label="Delayed" value={pCountFor("delayed")} icon="alert" tone="danger" href="/projects" />
          <StatCard label="On hold" value={pCountFor("on_hold")} icon="folder" tone="warning" href="/projects" />
          <StatCard label="Completed" value={pCountFor("completed")} icon="check-circle" href="/projects" />
        </div>
      </section>

      <SectionCard title="Sites needing attention" action={<Link href="/sites" className="text-xs font-medium text-accent">View map</Link>}>
        {attentionSites.length === 0 ? (
          <EmptyState icon="check-circle" title="All sites are on track" />
        ) : (
          <ul className="divide-y divide-border">
            {attentionSites.map((s) => (
              <li key={s.id}>
                <Link href={`/sites/${s.id}`} className="flex items-center justify-between py-2.5 text-sm hover:opacity-80">
                  <div>
                    <div className="font-medium text-foreground">{s.name}</div>
                    <div className="text-xs text-muted">{s.city}{s.healthReason ? ` · ${s.healthReason}` : ""}</div>
                  </div>
                  <Badge status={s.healthStatus} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
