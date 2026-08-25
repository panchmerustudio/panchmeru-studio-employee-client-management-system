import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { employees, users, roles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";

export default async function EmployeesPage() {
  const user = await requirePermission(PERMISSIONS.EMPLOYEE_VIEW).catch(() => null);
  if (!user) redirect("/home");

  const rows = await db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      name: users.name,
      designation: employees.designation,
      department: employees.department,
      city: employees.city,
      status: employees.status,
      roleName: roles.name,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .orderBy(employees.employeeCode);

  const canManage = user.permissions.includes(PERMISSIONS.EMPLOYEE_MANAGE);

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={`${rows.length} people at Panchmeru Studio`}
        action={
          canManage && (
            <Link href="/employees/new" className="btn btn-accent">
              <Icon name="plus" className="h-4 w-4" /> Add employee
            </Link>
          )
        }
      />

      {rows.length === 0 ? (
        <EmptyState icon="users" title="No employees yet" subtitle="Add your first team member to get started." />
      ) : (
        <div className="card divide-y divide-border overflow-hidden">
          {rows.map((r) => (
            <Link key={r.id} href={`/employees/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-background">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-ink text-sm font-semibold text-white">
                  {r.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{r.name}</div>
                  <div className="text-xs text-muted">
                    {r.code} · {r.designation || r.roleName} {r.city ? `· ${r.city}` : ""}
                  </div>
                </div>
              </div>
              <Badge status={r.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
