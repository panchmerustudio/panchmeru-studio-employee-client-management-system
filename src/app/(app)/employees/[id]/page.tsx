import { notFound, redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, users, roles, employeeDocuments, siteAssignments, sites } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { StatusButtons } from "./status-buttons";
import { SalaryForm } from "./salary-form";
import { DocumentUploadForm } from "./document-upload-form";
import { Icon } from "@/components/icon";
import { getAllBalances } from "@/lib/leave-policy";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePermission(PERMISSIONS.EMPLOYEE_VIEW).catch(() => null);
  if (!viewer) redirect("/home");

  const row = await db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      name: users.name,
      email: users.email,
      mobile: employees.mobile,
      city: employees.city,
      state: employees.state,
      designation: employees.designation,
      department: employees.department,
      employmentType: employees.employmentType,
      status: employees.status,
      joiningDate: employees.joiningDate,
      roleName: roles.name,
      emergencyContactName: employees.emergencyContactName,
      emergencyContactPhone: employees.emergencyContactPhone,
      monthlySalary: employees.monthlySalary,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(employees.id, id))
    .then((r) => r[0]);

  if (!row) notFound();

  const docs = await db.select().from(employeeDocuments).where(eq(employeeDocuments.employeeId, id)).orderBy(desc(employeeDocuments.createdAt));
  const assignments = await db
    .select({ siteName: sites.name, city: sites.city, role: siteAssignments.role })
    .from(siteAssignments)
    .innerJoin(sites, eq(sites.id, siteAssignments.siteId))
    .where(eq(siteAssignments.employeeId, id));

  const canManage = viewer.permissions.includes(PERMISSIONS.EMPLOYEE_MANAGE);
  const balances = canManage ? await getAllBalances(id, new Date().getFullYear()) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={row.name}
        subtitle={`${row.code} · ${row.roleName}`}
        action={<Badge status={row.status} />}
      />

      <div className="grid gap-5 md:grid-cols-3">
        <div className="space-y-5 md:col-span-2">
          <SectionCard title="Personal & employment">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Info label="Mobile" value={row.mobile} />
              <Info label="Email" value={row.email || "—"} />
              <Info label="City" value={row.city ? `${row.city}, ${row.state ?? ""}` : "—"} />
              <Info label="Designation" value={row.designation || "—"} />
              <Info label="Department" value={row.department || "—"} />
              <Info label="Employment type" value={row.employmentType?.replace("_", " ") ?? "—"} />
              <Info label="Joining date" value={formatDate(row.joiningDate)} />
              <Info label="Emergency contact" value={row.emergencyContactName ? `${row.emergencyContactName} (${row.emergencyContactPhone})` : "—"} />
            </dl>
          </SectionCard>

          <SectionCard title="Site assignments">
            {assignments.length === 0 ? (
              <p className="text-sm text-muted">Not currently assigned to any site.</p>
            ) : (
              <ul className="space-y-2">
                {assignments.map((a, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span>{a.siteName}</span>
                    <span className="text-muted">{a.city} · {a.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Documents">
            {docs.length === 0 ? (
              <p className="mb-3 text-sm text-muted">No documents uploaded yet.</p>
            ) : (
              <ul className="mb-3 divide-y divide-border">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Icon name="file" className="h-4 w-4 text-muted" />
                      <span className="capitalize">{d.docType.replace("_", " ")}</span>
                    </div>
                    <a className="text-xs font-medium text-accent" href={`/api/files/${d.fileId}`} target="_blank" rel="noreferrer">
                      View
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {canManage && <DocumentUploadForm employeeId={id} />}
          </SectionCard>
        </div>

        {canManage && (
          <div className="space-y-5">
            <SectionCard title="Actions">
              <StatusButtons employeeId={id} status={row.status} />
            </SectionCard>

            <SectionCard title="Payroll">
              <label className="mb-1.5 block text-xs font-medium text-muted">Monthly salary</label>
              <SalaryForm employeeId={id} monthlySalary={row.monthlySalary} />
              {balances.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  <div className="text-xs font-medium text-muted">{new Date().getFullYear()} leave balance</div>
                  {balances.map((b) => (
                    <div key={b.leaveTypeId} className="flex items-center justify-between text-sm">
                      <span>{b.name}</span>
                      <span className="font-medium">{b.remaining} / {b.allocated} left</span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground capitalize">{value}</dd>
    </div>
  );
}
