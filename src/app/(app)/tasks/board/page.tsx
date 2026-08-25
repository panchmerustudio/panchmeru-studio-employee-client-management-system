import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, projects, sites, tasks, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/icon";
import { TaskBoard } from "./board";

/**
 * The active pipeline only — matches how Rally boards work (finished/
 * archived work lives off-board). Overdue/rescheduled/cancelled tasks
 * stay visible in the list view (/tasks) with its existing status
 * filters; this board is for what's currently moving.
 */
export const BOARD_COLUMNS = [
  { key: "to_do", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "submitted", label: "Submitted" },
  { key: "modification_required", label: "Needs Changes" },
  { key: "approved", label: "Approved" },
] as const;

export default async function TaskBoardPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const canViewAll = user.permissions.includes(PERMISSIONS.TASK_VIEW_ALL);
  const canApprove = user.permissions.includes(PERMISSIONS.TASK_APPROVE);
  const canCreate = user.permissions.includes(PERMISSIONS.TASK_CREATE);

  const baseQuery = db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      assignedToId: tasks.assignedToId,
      assignedToName: users.name,
      siteName: sites.name,
      projectName: projects.name,
    })
    .from(tasks)
    .innerJoin(employees, eq(employees.id, tasks.assignedToId))
    .innerJoin(users, eq(users.id, employees.userId))
    .leftJoin(sites, eq(sites.id, tasks.siteId))
    .leftJoin(projects, eq(projects.id, tasks.projectId));

  const rows = canViewAll
    ? await baseQuery.orderBy(desc(tasks.updatedAt))
    : await baseQuery.where(eq(tasks.assignedToId, user.employeeId ?? "")).orderBy(desc(tasks.updatedAt));

  const columnKeys = new Set<string>(BOARD_COLUMNS.map((c) => c.key));
  const now = Date.now();
  const cards = rows
    .filter((r) => columnKeys.has(r.status))
    .map((r) => ({
      ...r,
      isMine: r.assignedToId === user.employeeId,
      isOverdue: !!r.dueDate && new Date(r.dueDate).getTime() < now && r.status !== "approved",
    }));

  return (
    <div>
      <PageHeader
        title="Task Board"
        subtitle="Drag a card, or use its Move menu on mobile"
        action={
          <div className="flex items-center gap-2">
            <Link href="/tasks" className="btn btn-secondary">
              List view
            </Link>
            {canCreate && (
              <Link href="/tasks/new" className="btn btn-accent">
                <Icon name="plus" className="h-4 w-4" /> New task
              </Link>
            )}
          </div>
        }
      />
      {cards.length === 0 ? (
        <p className="text-sm text-muted">No active tasks right now.</p>
      ) : (
        <TaskBoard cards={cards} canApprove={canApprove} />
      )}
    </div>
  );
}
