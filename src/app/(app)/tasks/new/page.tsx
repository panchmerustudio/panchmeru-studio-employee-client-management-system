import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, users, projects, sites } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { NewTaskForm } from "./form";

export default async function NewTaskPage() {
  const user = await requirePermission(PERMISSIONS.TASK_CREATE).catch(() => null);
  if (!user) redirect("/tasks");

  const employeeRows = await db
    .select({ id: employees.id, name: users.name })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.status, "active"));

  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.status, "active"));
  const siteRows = await db.select({ id: sites.id, name: sites.name, projectId: sites.projectId }).from(sites).where(eq(sites.status, "active"));

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New task" subtitle="Assign work to a team member" />
      <NewTaskForm employees={employeeRows} projects={projectRows} sites={siteRows} />
    </div>
  );
}
