"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveRequests, employees, users, roles, attendanceRecords, notifications } from "@/db/schema";
import { requireUser, requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/rbac";
import { saveFile } from "@/lib/storage";
import { countLeaveDays, computeApprovalSplit, dailyRate } from "@/lib/leave-policy";

const schema = z.object({
  leaveTypeId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  isHalfDay: z.string().optional(),
  reason: z.string().min(3, "Tell us the reason for leave."),
});

export type FormState = { error?: string; ok?: boolean };

export async function applyLeave(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser().catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };
  if (!actor.employeeId) return { error: "No employee profile linked to your account." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const data = parsed.data;

  if (new Date(data.endDate) < new Date(data.startDate)) {
    return { error: "End date can't be before the start date." };
  }

  // No duplicate leave in the same timeframe: block if this employee already
  // has a pending or approved request whose date range overlaps this one.
  // (Rejected/cancelled requests don't block — those dates are free again.)
  const overlapping = await db.query.leaveRequests.findFirst({
    where: and(
      eq(leaveRequests.employeeId, actor.employeeId),
      inArray(leaveRequests.status, ["pending", "approved"]),
      lte(leaveRequests.startDate, new Date(data.endDate)),
      gte(leaveRequests.endDate, new Date(data.startDate))
    ),
  });
  if (overlapping) {
    return {
      error: `You already have a ${overlapping.status} leave request covering ${formatDate(overlapping.startDate)}–${formatDate(overlapping.endDate)}. Cancel that one first if you need to change it.`,
    };
  }

  let attachmentFileId: string | undefined;
  const file = formData.get("attachment") as File | null;
  if (file && file.size > 0) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveFile({ buffer, originalName: file.name, mimeType: file.type || "application/octet-stream", kind: "document", uploadedBy: actor.id });
    attachmentFileId = saved.id;
  }

  const workingDays = countLeaveDays(new Date(data.startDate), new Date(data.endDate), data.isHalfDay === "on");

  const [request] = await db
    .insert(leaveRequests)
    .values({
      employeeId: actor.employeeId,
      leaveTypeId: data.leaveTypeId,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      isHalfDay: data.isHalfDay === "on",
      reason: data.reason,
      attachmentFileId,
      status: "pending",
      workingDays,
    })
    .returning();

  const approvers = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(inArray(roles.key, ["owner", "manager"]));
  for (const approver of approvers) {
    await db.insert(notifications).values({
      recipientId: approver.id,
      type: "leave_requested",
      title: "New leave request",
      message: `${actor.name} requested leave from ${data.startDate} to ${data.endDate}.`,
      relatedEntityType: "leave_request",
      relatedEntityId: request.id,
    });
  }

  await recordAudit({ actor, action: "leave.applied", entityType: "leave_request", entityId: request.id, newState: data });
  revalidatePath("/leave");
  return { ok: true };
}

/** Lets an employee cancel their own still-pending request — the fix for the duplicate-timeframe block above when they applied with the wrong dates. */
export async function cancelLeaveRequest(leaveId: string) {
  const actor = await requireUser();
  const request = await db.query.leaveRequests.findFirst({ where: eq(leaveRequests.id, leaveId) });
  if (!request) throw new Error("Leave request not found.");
  if (request.employeeId !== actor.employeeId) throw new Error("You can only cancel your own leave requests.");
  if (request.status !== "pending") throw new Error("Only a pending request can be cancelled — this one has already been reviewed.");

  await db.update(leaveRequests).set({ status: "cancelled" }).where(eq(leaveRequests.id, leaveId));
  await recordAudit({ actor, action: "leave.cancelled", entityType: "leave_request", entityId: leaveId });
  revalidatePath("/leave");
}

export async function decideLeave(leaveId: string, decision: "approved" | "rejected", comment: string) {
  const actor = await requirePermission(PERMISSIONS.LEAVE_APPROVE);
  const before = await db.query.leaveRequests.findFirst({ where: eq(leaveRequests.id, leaveId) });
  if (!before) throw new Error("Leave request not found.");
  // Guards against two managers acting on the same request at once (e.g. both open it from a
  // notification) — whoever's decision lands first wins, the second gets a clear error instead of
  // silently double-processing the paid/unpaid split and deduction below.
  if (before.status !== "pending") throw new Error(`This request was already ${before.status} — nothing to do.`);

  const employee = await db.query.employees.findFirst({ where: eq(employees.id, before.employeeId) });

  let paidDays: number | null = null;
  let unpaidDays: number | null = null;
  let deductionAmount: number | null = null;

  if (decision === "approved") {
    const workingDays = before.workingDays || countLeaveDays(new Date(before.startDate), new Date(before.endDate), before.isHalfDay);
    const split = await computeApprovalSplit(before.employeeId, before.leaveTypeId, workingDays, new Date(before.startDate));
    paidDays = split.paidDays;
    unpaidDays = split.unpaidDays;
    deductionAmount = unpaidDays > 0 ? Math.round(unpaidDays * dailyRate(employee?.monthlySalary) * 100) / 100 : 0;
  }

  await db
    .update(leaveRequests)
    .set({
      status: decision,
      reviewedBy: actor.id,
      reviewedAt: new Date(),
      reviewComment: comment || null,
      ...(decision === "approved" ? { paidDays, unpaidDays, deductionAmount } : {}),
    })
    .where(eq(leaveRequests.id, leaveId));

  if (decision === "approved") {
    const start = new Date(before.startDate);
    const end = new Date(before.endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const existing = await db.query.attendanceRecords.findFirst({
        where: (r, { and, eq: eqOp }) => and(eqOp(r.employeeId, before.employeeId), eqOp(r.date, dateStr)),
      });
      if (existing) {
        await db.update(attendanceRecords).set({ status: "on_leave" }).where(eq(attendanceRecords.id, existing.id));
      } else {
        await db.insert(attendanceRecords).values({ employeeId: before.employeeId, date: dateStr, status: "on_leave" });
      }
    }
  }

  if (employee) {
    const deductionNote =
      decision === "approved" && unpaidDays && unpaidDays > 0
        ? ` ${unpaidDays} day${unpaidDays === 1 ? "" : "s"} of this exceeds your leave balance and is unpaid${
            deductionAmount ? ` — ₹${deductionAmount.toLocaleString("en-IN")} will be deducted from salary.` : "."
          }`
        : "";
    await db.insert(notifications).values({
      recipientId: employee.userId,
      type: "leave_result",
      title: decision === "approved" ? "Leave approved" : "Leave rejected",
      message: `Your leave request has been ${decision}${comment ? `: ${comment}` : "."}${deductionNote}`,
      relatedEntityType: "leave_request",
      relatedEntityId: leaveId,
    });
  }

  await recordAudit({
    actor,
    action: `leave.${decision}`,
    entityType: "leave_request",
    entityId: leaveId,
    previousState: { status: before.status },
    newState: { status: decision, comment, paidDays, unpaidDays, deductionAmount },
  });
  revalidatePath("/leave");
  revalidatePath("/reports");
}
