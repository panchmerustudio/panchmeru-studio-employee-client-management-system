import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveRequests, leaveTypes, employees, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { ApplyLeaveForm } from "./apply-form";
import { ApprovalRow } from "./approval-row";
import { CancelRequestButton } from "./cancel-request-button";
import { getAllBalances, computeApprovalSplit, dailyRate } from "@/lib/leave-policy";

export default async function LeavePage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const types = await db.select().from(leaveTypes);
  const canApprove = user.permissions.includes(PERMISSIONS.LEAVE_APPROVE);
  const currentYear = new Date().getFullYear();

  const balances = user.employeeId ? await getAllBalances(user.employeeId, currentYear) : [];

  const myRequests = user.employeeId
    ? await db
        .select({ id: leaveRequests.id, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, reason: leaveRequests.reason, status: leaveRequests.status, typeName: leaveTypes.name, unpaidDays: leaveRequests.unpaidDays, deductionAmount: leaveRequests.deductionAmount })
        .from(leaveRequests)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(eq(leaveRequests.employeeId, user.employeeId))
        .orderBy(desc(leaveRequests.createdAt))
    : [];

  const pendingApprovalsRaw = canApprove
    ? await db
        .select({
          id: leaveRequests.id,
          employeeId: leaveRequests.employeeId,
          leaveTypeId: leaveRequests.leaveTypeId,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          reason: leaveRequests.reason,
          isHalfDay: leaveRequests.isHalfDay,
          workingDays: leaveRequests.workingDays,
          typeName: leaveTypes.name,
          employeeName: users.name,
          monthlySalary: employees.monthlySalary,
        })
        .from(leaveRequests)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
        .innerJoin(users, eq(users.id, employees.userId))
        .where(eq(leaveRequests.status, "pending"))
        .orderBy(desc(leaveRequests.createdAt))
    : [];

  const pendingApprovals = await Promise.all(
    pendingApprovalsRaw.map(async (r) => {
      const split = await computeApprovalSplit(r.employeeId, r.leaveTypeId, r.workingDays, new Date(r.startDate));
      const previewDeduction = split.unpaidDays > 0 ? Math.round(split.unpaidDays * dailyRate(r.monthlySalary) * 100) / 100 : 0;
      return { ...r, previewPaidDays: split.paidDays, previewUnpaidDays: split.unpaidDays, previewDeduction };
    })
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Leave" subtitle="Apply for and manage leave" />

      {user.employeeId && balances.length > 0 && (
        <SectionCard title={`Your ${currentYear} leave balance`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {balances.map((b) => (
              <div key={b.leaveTypeId} className="rounded-lg border border-border p-3 text-center">
                <div className="text-xs text-muted">{b.name}</div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {b.remaining}
                  <span className="text-xs font-normal text-muted"> / {b.allocated} left</span>
                </div>
                {b.used > 0 && <div className="text-[11px] text-muted">{b.used} used this year</div>}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Approved days beyond your balance are unpaid and deduct from salary — see the notice on any request that goes over.
          </p>
        </SectionCard>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {user.employeeId && (
          <SectionCard title="Apply for leave">
            <ApplyLeaveForm types={types.map((t) => ({ id: t.id, name: t.name }))} />
          </SectionCard>
        )}

        <SectionCard title="Your requests">
          {myRequests.length === 0 ? (
            <p className="text-sm text-muted">No leave requests yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {myRequests.map((r) => (
                <li key={r.id} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{r.typeName}</div>
                      <div className="text-xs text-muted">
                        {formatDate(r.startDate)} – {formatDate(r.endDate)} · {r.reason}
                      </div>
                    </div>
                    <Badge status={r.status} />
                  </div>
                  {r.status === "approved" && r.unpaidDays != null && r.unpaidDays > 0 && (
                    <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                      {r.unpaidDays} day{r.unpaidDays === 1 ? "" : "s"} unpaid
                      {r.deductionAmount ? ` · ₹${r.deductionAmount.toLocaleString("en-IN")} deducted` : ""}
                    </div>
                  )}
                  {r.status === "pending" && <CancelRequestButton leaveId={r.id} />}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {canApprove && (
        <SectionCard title={`Pending approvals (${pendingApprovals.length})`}>
          {pendingApprovals.length === 0 ? (
            <EmptyState icon="calendar" title="No pending leave requests" />
          ) : (
            <div className="space-y-3">
              {pendingApprovals.map((r) => (
                <ApprovalRow key={r.id} request={r} />
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
