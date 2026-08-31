"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, employees, roles, employeeDocuments } from "@/db/schema";
import { requirePermission, hashPassword } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { registerUploadedFile } from "@/lib/storage";

const employeeSchema = z.object({
  name: z.string().min(2, "Enter the employee's full name."),
  email: z.string().email("Enter a valid email.").optional().or(z.literal("")),
  mobile: z.string().min(8, "Enter a valid mobile number."),
  roleKey: z.enum(["owner", "manager", "supervisor", "employee"]),
  designation: z.string().optional(),
  department: z.string().optional(),
  city: z.string().optional(),
  employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).default("full_time"),
  monthlySalary: z.string().optional(),
});

export type FormState = { error?: string; ok?: boolean; tempPassword?: string };

export async function createEmployee(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE).catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const data = parsed.data;

  const existing = data.email ? await db.query.users.findFirst({ where: eq(users.email, data.email) }) : null;
  if (existing) return { error: "A user with this email already exists." };

  const role = await db.query.roles.findFirst({ where: eq(roles.key, data.roleKey) });
  if (!role) return { error: "Invalid role selected." };

  const monthlySalary = data.monthlySalary && data.monthlySalary.trim() !== "" ? Number(data.monthlySalary) : null;
  if (monthlySalary !== null && (Number.isNaN(monthlySalary) || monthlySalary < 0)) {
    return { error: "Monthly salary must be a positive number." };
  }

  // Temp password — shown once to the owner/manager to hand to the employee at onboarding.
  const tempPassword = `Welcome${Math.floor(1000 + Math.random() * 9000)}`;
  const passwordHash = await hashPassword(tempPassword);

  const [user] = await db
    .insert(users)
    .values({
      name: data.name,
      email: data.email || null,
      phone: data.mobile,
      passwordHash,
      roleId: role.id,
      mustChangePassword: true,
      status: "active",
    })
    .returning();

  const countRow = await db.select({ count: sql<number>`count(*)` }).from(employees);
  const code = `PMS-${String((countRow[0]?.count ?? 0) + 1).padStart(4, "0")}`;

  const [employee] = await db
    .insert(employees)
    .values({
      userId: user.id,
      employeeCode: code,
      mobile: data.mobile,
      email: data.email || null,
      city: data.city || null,
      designation: data.designation || null,
      department: data.department || null,
      employmentType: data.employmentType,
      joiningDate: new Date(),
      status: "active",
      monthlySalary,
    })
    .returning();

  await recordAudit({ actor, action: "employee.created", entityType: "employee", entityId: employee.id, newState: { name: data.name, roleKey: data.roleKey } });
  revalidatePath("/employees");
  return { ok: true, tempPassword };
}

export async function setEmployeeStatus(employeeId: string, status: "active" | "on_leave" | "exited") {
  const actor = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE);
  const before = await db.query.employees.findFirst({ where: eq(employees.id, employeeId) });
  await db
    .update(employees)
    .set({ status, exitDate: status === "exited" ? new Date() : null })
    .where(eq(employees.id, employeeId));
  if (before) {
    const user = await db.query.users.findFirst({ where: eq(users.id, before.userId) });
    if (user) {
      await db.update(users).set({ status: status === "exited" ? "inactive" : "active" }).where(eq(users.id, user.id));
    }
  }
  await recordAudit({ actor, action: "employee.status_changed", entityType: "employee", entityId: employeeId, previousState: { status: before?.status }, newState: { status } });
  revalidatePath("/employees");
  revalidatePath(`/employees/${employeeId}`);
}

export async function updateEmployeeSalary(employeeId: string, monthlySalaryRaw: string) {
  const actor = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE);
  const monthlySalary = monthlySalaryRaw.trim() === "" ? null : Number(monthlySalaryRaw);
  if (monthlySalary !== null && (Number.isNaN(monthlySalary) || monthlySalary < 0)) {
    throw new Error("Monthly salary must be a positive number.");
  }
  const before = await db.query.employees.findFirst({ where: eq(employees.id, employeeId) });
  await db.update(employees).set({ monthlySalary }).where(eq(employees.id, employeeId));
  await recordAudit({
    actor,
    action: "employee.salary_updated",
    entityType: "employee",
    entityId: employeeId,
    previousState: { monthlySalary: before?.monthlySalary },
    newState: { monthlySalary },
  });
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/reports");
}

export async function uploadEmployeeDocument(employeeId: string, formData: FormData) {
  const actor = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE);
  const fileKey = formData.get("fileKey") as string | null;
  const fileMimeType = formData.get("fileMimeType") as string | null;
  const fileOriginalName = formData.get("fileOriginalName") as string | null;
  const docType = String(formData.get("docType") || "other");
  if (!fileKey || !fileMimeType || !fileOriginalName) throw new Error("Choose and upload a file first.");

  const saved = await registerUploadedFile({
    key: fileKey,
    originalName: fileOriginalName,
    mimeType: fileMimeType,
    kind: "document",
    visibility: "internal",
    uploadedBy: actor.id,
    relatedEntityType: "employee",
    relatedEntityId: employeeId,
  });

  await db.insert(employeeDocuments).values({
    employeeId,
    docType: docType as "identity" | "pan" | "resume" | "qualification" | "experience" | "bank_details" | "joining_document" | "other",
    fileId: saved.id,
    uploadedBy: actor.id,
  });

  await recordAudit({ actor, action: "employee.document_uploaded", entityType: "employee", entityId: employeeId, newState: { docType, fileName: fileOriginalName } });
  revalidatePath(`/employees/${employeeId}`);
}
