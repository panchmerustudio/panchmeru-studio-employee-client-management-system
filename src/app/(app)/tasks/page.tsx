import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks, employees, users, sites } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { Icon } from "@/components/icon";

const STATUSES = ["to_do", "in_progress", "submitted", "modification_required", "approved", "overdue", "rescheduled", "cancelled"];

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  const { status } = await searchParams;

  const canViewAll = user.permissions.includes(PERMISSIONS.TASK_VIEW_ALL);
  const canCreate = user.permissions.includes(PERMISSIONS.TASK_CREATE);

  const baseQuery = db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      assignedToName: users.name,
      siteName: sites.name,
    })
    .from(tasks)
    .innerJoin(employees, eq(employees.id, tasks.assignedToId))
    .innerJoin(users, eq(users.id, employees.userId))
    .leftJoin(sites, eq(sites.id, tasks.siteId));

  const rows = canViewAll
    ? await baseQuery.orderBy(desc(tasks.updatedAt))
    : await baseQuery.where(eq(tasks.assignedToId, user.employeeId ?? "")).orderBy(desc(tasks.updatedAt));

  const filtered = status ? rows.filter((r) => r.status === status) : rows;

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={`${filtered.length} task${filtered.length === 1 ? "" : "s"}`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/tasks/board" className="btn btn-secondary">
              <Icon name="grid" className="h-4 w-4" /> Board view
            </Link>
            {canCreate && (
              <Link href="/tasks/new" className="btn btn-accent">
                <Icon name="plus" className="h-4 w-4" /> New task
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <Link href="/tasks" className={`badge ${!status ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}>All</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/tasks?status=${s}`} className={`badge whitespace-nowrap ${status === s ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}>
            {s.replace("_", " ")}
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="check" title="No tasks here" subtitle="Nothing matches this filter yet." />
      ) : (
        <div className="card divide-y divide-border">
          {filtered.map((t) => (
            <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-background">
              <div>
                <div className="text-sm font-medium text-foreground">{t.title}</div>
                <div className="text-xs text-muted">
                  {t.assignedToName} {t.siteName ? `· ${t.siteName}` : ""} {t.dueDate ? `· due ${formatDate(t.dueDate)}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {t.priority === "urgent" && <span className="badge bg-red-100 text-red-700">Urgent</span>}
                <Badge status={t.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
