import { redirect } from "next/navigation";
import { sql, eq, and, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { attendanceRecords, tasks, siteVisits, sites, leaveRequests, employees, users } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, EmptyState } from "@/components/ui";
import { yearBounds } from "@/lib/leave-policy";

export default async function ReportsPage() {
  const user = await requirePermission(PERMISSIONS.REPORT_VIEW).catch(() => null);
  if (!user) redirect("/home");
  const canSeePayroll = user.permissions.includes(PERMISSIONS.EMPLOYEE_MANAGE);

  const taskByStatus = await db.select({ status: tasks.status, count: sql<number>`count(*)` }).from(tasks).groupBy(tasks.status);
  const attendanceByStatus = await db.select({ status: attendanceRecords.status, count: sql<number>`count(*)` }).from(attendanceRecords).groupBy(attendanceRecords.status);
  const leaveByStatus = await db.select({ status: leaveRequests.status, count: sql<number>`count(*)` }).from(leaveRequests).groupBy(leaveRequests.status);
  const visitsByCity = await db
    .select({ city: sites.city, count: sql<number>`count(*)` })
    .from(siteVisits)
    .innerJoin(sites, eq(sites.id, siteVisits.siteId))
    .groupBy(sites.city);

  let payroll: { employeeId: string; name: string; monthlySalary: number | null; unpaidDays: number; deductionAmount: number }[] = [];
  if (canSeePayroll) {
    const { start, end } = yearBounds(new Date().getFullYear());
    const activeEmployees = await db
      .select({ id: employees.id, name: users.name, monthlySalary: employees.monthlySalary })
      .from(employees)
      .innerJoin(users, eq(users.id, employees.userId))
      .where(eq(employees.status, "active"));

    const approvedLeaves = await db
      .select({ employeeId: leaveRequests.employeeId, unpaidDays: leaveRequests.unpaidDays, deductionAmount: leaveRequests.deductionAmount })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.status, "approved"), gte(leaveRequests.startDate, start), lte(leaveRequests.startDate, end)));

    payroll = activeEmployees.map((e) => {
      const mine = approvedLeaves.filter((l) => l.employeeId === e.id);
      return {
        employeeId: e.id,
        name: e.name,
        monthlySalary: e.monthlySalary,
        unpaidDays: mine.reduce((sum, l) => sum + (l.unpaidDays ?? 0), 0),
        deductionAmount: mine.reduce((sum, l) => sum + (l.deductionAmount ?? 0), 0),
      };
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle="Studio activity at a glance" />

      <div className="grid gap-5 md:grid-cols-2">
        <SectionCard title="Tasks by status">
          <BarList data={taskByStatus} />
        </SectionCard>
        <SectionCard title="Attendance by status">
          <BarList data={attendanceByStatus} />
        </SectionCard>
        <SectionCard title="Leave requests by status">
          <BarList data={leaveByStatus} />
        </SectionCard>
        <SectionCard title="Site visits by city">
          <BarList data={visitsByCity.map((v) => ({ status: v.city, count: v.count }))} />
        </SectionCard>
      </div>

      {canSeePayroll && (
        <SectionCard title={`Payroll — ${new Date().getFullYear()} leave deductions`}>
          <p className="mb-3 text-xs text-muted">
            Studio policy: 8 sick + 15 annual leave days/year, paid. Approved days beyond that are unpaid at (monthly salary ÷ 30) per day.
          </p>
          {payroll.length === 0 ? (
            <EmptyState icon="users" title="No active employees" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-2 font-medium">Employee</th>
                    <th className="py-2 font-medium">Monthly salary</th>
                    <th className="py-2 font-medium">Unpaid days (YTD)</th>
                    <th className="py-2 font-medium">Deduction (YTD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payroll.map((p) => (
                    <tr key={p.employeeId}>
                      <td className="py-2">{p.name}</td>
                      <td className="py-2">{p.monthlySalary != null ? `₹${p.monthlySalary.toLocaleString("en-IN")}` : <span className="text-muted">not set</span>}</td>
                      <td className="py-2">{p.unpaidDays > 0 ? p.unpaidDays : "—"}</td>
                      <td className="py-2">
                        {p.deductionAmount > 0 ? (
                          <span className="font-medium text-amber-700">₹{p.deductionAmount.toLocaleString("en-IN")}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}

function BarList({ data }: { data: { status: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  if (data.length === 0) return <p className="text-sm text-muted">No data yet.</p>;
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.status} className="flex items-center gap-3">
          <span className="w-32 shrink-0 text-xs capitalize text-muted">{d.status.replace(/_/g, " ")}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-ink" style={{ width: `${(d.count / max) * 100}%` }} />
          </div>
          <span className="w-6 shrink-0 text-right text-xs font-semibold">{d.count}</span>
        </li>
      ))}
    </ul>
  );
}
