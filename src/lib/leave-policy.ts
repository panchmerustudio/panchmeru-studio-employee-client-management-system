import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveRequests, leaveTypes } from "@/db/schema";

/**
 * Studio leave policy: Sick Leave = 8 days/year, Annual Leave = 15 days/year
 * (seeded in src/db/seed.ts as leaveTypes.maxDaysPerYear — change the policy
 * there, not here). Once an employee has used their full allocation for a
 * leave type in a calendar year, any further approved days for that type are
 * unpaid and deduct from salary at (monthlySalary / 30) per day. The split
 * between paid and unpaid days is only ever computed at approval time, never
 * at apply time, so it always reflects what's actually been approved so far
 * this year — not what's merely pending.
 */

export function countLeaveDays(startDate: Date, endDate: Date, isHalfDay: boolean): number {
  if (isHalfDay) return 0.5;
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.max(diffDays, 1);
}

export function yearBounds(year: number) {
  return { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999) };
}

/** Per-day salary deduction rate. A monthly figure ÷ 30 is the standard
 *  convention for loss-of-pay calculations — swap for a real payroll
 *  calendar (working days in the month) if the studio wants that instead. */
export function dailyRate(monthlySalary: number | null | undefined): number {
  return monthlySalary && monthlySalary > 0 ? monthlySalary / 30 : 0;
}

/** Paid days already consumed (and thus the remaining balance) for one
 *  employee/leave-type/year, counting only *approved* requests. Pending or
 *  rejected requests never touch the balance. */
export async function getLeaveBalance(employeeId: string, leaveTypeId: string, year: number) {
  const type = await db.query.leaveTypes.findFirst({ where: eq(leaveTypes.id, leaveTypeId) });
  const allocated = type?.maxDaysPerYear ?? 0;
  const { start, end } = yearBounds(year);

  const approved = await db
    .select({ paidDays: leaveRequests.paidDays, workingDays: leaveRequests.workingDays })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.leaveTypeId, leaveTypeId),
        eq(leaveRequests.status, "approved"),
        gte(leaveRequests.startDate, start),
        lte(leaveRequests.startDate, end)
      )
    );

  // paidDays is set once a request is decided; fall back to workingDays for
  // any legacy row decided before this field existed.
  const used = approved.reduce((sum, r) => sum + (r.paidDays ?? r.workingDays ?? 0), 0);
  return { allocated, used, remaining: Math.max(allocated - used, 0) };
}

/** All leave types with this employee's balance for the given year — used to
 *  show "Sick: 3/8 used, 5 remaining" on the Leave page. */
export async function getAllBalances(employeeId: string, year: number) {
  const types = await db.select().from(leaveTypes).where(eq(leaveTypes.active, true));
  return Promise.all(
    types.map(async (t) => {
      const balance = await getLeaveBalance(employeeId, t.id, year);
      return { leaveTypeId: t.id, key: t.key, name: t.name, ...balance };
    })
  );
}

/** How a request of `workingDays` splits into paid vs. unpaid, based on the
 *  balance remaining *before* this request (i.e. from previously approved
 *  requests only — never from itself). */
export async function computeApprovalSplit(employeeId: string, leaveTypeId: string, workingDays: number, referenceDate: Date) {
  const year = referenceDate.getFullYear();
  const balance = await getLeaveBalance(employeeId, leaveTypeId, year);
  const paidDays = Math.min(balance.remaining, workingDays);
  const unpaidDays = Math.max(workingDays - paidDays, 0);
  return { paidDays, unpaidDays, allocated: balance.allocated, remainingBefore: balance.remaining };
}
