"use server";

import { randomBytes } from "crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { vendors, vendorUsers, vendorAssignments, vendorCategoryAccess, documentCategories } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { hashVendorPassword } from "@/lib/vendor-auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

/** Common trades -> the document category they default to seeing (best-effort name match against documentCategories.name). */
export const VENDOR_TRADE_CATEGORIES: { trade: string; categoryName: string | null }[] = [
  { trade: "Electrician", categoryName: "Electrical" },
  { trade: "Plumber", categoryName: "Plumbing" },
  { trade: "HVAC Contractor", categoryName: "HVAC" },
  { trade: "Carpenter", categoryName: "Furniture" },
  { trade: "Flooring Contractor", categoryName: "Flooring" },
  { trade: "False Ceiling Contractor", categoryName: "Ceiling" },
  { trade: "Structural Contractor", categoryName: "Structural" },
  { trade: "Painter", categoryName: null },
  { trade: "Mason", categoryName: null },
  { trade: "Other", categoryName: null },
];

function generateTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const createSchema = z.object({
  name: z.string().min(2, "Give the vendor a name."),
  email: z.string().email("A valid email is needed for their portal login."),
  mobile: z.string().optional(),
  category: z.string().optional(),
  address: z.string().optional(),
});

export type CreateVendorState = { error?: string; ok?: boolean; vendorId?: string; tempPassword?: string; loginEmail?: string };

export async function createVendor(_prev: CreateVendorState, formData: FormData): Promise<CreateVendorState> {
  const actor = await requirePermission(PERMISSIONS.VENDOR_MANAGE).catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const data = parsed.data;
  const email = data.email.trim().toLowerCase();

  const existing = await db.query.vendorUsers.findFirst({ where: eq(vendorUsers.email, email) });
  if (existing) return { error: "A vendor login with this email already exists." };

  const [vendor] = await db
    .insert(vendors)
    .values({ name: data.name, category: data.category || null, mobile: data.mobile || null, email, address: data.address || null, status: "active" })
    .returning();

  const tempPassword = generateTempPassword();
  await db.insert(vendorUsers).values({
    vendorId: vendor.id,
    contactName: data.name,
    email,
    passwordHash: await hashVendorPassword(tempPassword),
    status: "active",
  });

  // Auto-grant the trade's default drawing category, if one matches — an
  // explicit admin override can add/remove categories afterward from the
  // vendor detail page (section 22-23: default access + admin override).
  const tradeMatch = VENDOR_TRADE_CATEGORIES.find((t) => t.trade === data.category);
  if (tradeMatch?.categoryName) {
    const cat = await db.query.documentCategories.findFirst({ where: eq(documentCategories.name, tradeMatch.categoryName) });
    if (cat) {
      await db.insert(vendorCategoryAccess).values({ vendorId: vendor.id, documentCategoryId: cat.id, isDefault: true, grantedByUserId: actor.id });
    }
  }

  await recordAudit({ actor, action: "vendor.created", entityType: "vendor", entityId: vendor.id, newState: { name: data.name, email, category: data.category } });
  revalidatePath("/vendors");
  return { ok: true, vendorId: vendor.id, tempPassword, loginEmail: email };
}

export type ResetPasswordState = { error?: string; ok?: boolean; tempPassword?: string };

export async function resetVendorPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const actor = await requirePermission(PERMISSIONS.VENDOR_MANAGE).catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const vendorUserId = formData.get("vendorUserId") as string;
  const vu = await db.query.vendorUsers.findFirst({ where: eq(vendorUsers.id, vendorUserId) });
  if (!vu) return { error: "Vendor login not found." };

  const tempPassword = generateTempPassword();
  await db.update(vendorUsers).set({ passwordHash: await hashVendorPassword(tempPassword), status: "active" }).where(eq(vendorUsers.id, vendorUserId));

  await recordAudit({ actor, action: "vendor.password_reset", entityType: "vendor_user", entityId: vendorUserId });
  revalidatePath(`/vendors/${vu.vendorId}`);
  return { ok: true, tempPassword };
}

export async function setVendorStatus(vendorId: string, status: "active" | "inactive") {
  const actor = await requirePermission(PERMISSIONS.VENDOR_MANAGE);
  await db.update(vendors).set({ status }).where(eq(vendors.id, vendorId));
  await recordAudit({ actor, action: "vendor.status_changed", entityType: "vendor", entityId: vendorId, newState: { status } });
  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath("/vendors");
}

export async function assignVendorToProject(vendorId: string, projectId: string, siteId: string | null) {
  const actor = await requirePermission(PERMISSIONS.VENDOR_MANAGE);
  if (!projectId) throw new Error("Choose a project.");

  const existing = await db.query.vendorAssignments.findFirst({
    where: and(eq(vendorAssignments.vendorId, vendorId), eq(vendorAssignments.projectId, projectId)),
  });
  if (existing) throw new Error("Already assigned to this project.");

  await db.insert(vendorAssignments).values({ vendorId, projectId, siteId: siteId || null, assignedByUserId: actor.id });
  await recordAudit({ actor, action: "vendor.assigned_to_project", entityType: "vendor", entityId: vendorId, newState: { projectId, siteId } });
  revalidatePath(`/vendors/${vendorId}`);
}

export async function removeVendorAssignment(assignmentId: string, vendorId: string) {
  const actor = await requirePermission(PERMISSIONS.VENDOR_MANAGE);
  await db.delete(vendorAssignments).where(eq(vendorAssignments.id, assignmentId));
  await recordAudit({ actor, action: "vendor.unassigned_from_project", entityType: "vendor", entityId: vendorId });
  revalidatePath(`/vendors/${vendorId}`);
}

export async function grantVendorCategory(vendorId: string, documentCategoryId: string) {
  const actor = await requirePermission(PERMISSIONS.VENDOR_MANAGE);
  const existing = await db.query.vendorCategoryAccess.findFirst({
    where: and(eq(vendorCategoryAccess.vendorId, vendorId), eq(vendorCategoryAccess.documentCategoryId, documentCategoryId)),
  });
  if (existing) return;
  await db.insert(vendorCategoryAccess).values({ vendorId, documentCategoryId, isDefault: false, grantedByUserId: actor.id });
  await recordAudit({ actor, action: "vendor.category_access_granted", entityType: "vendor", entityId: vendorId, newState: { documentCategoryId } });
  revalidatePath(`/vendors/${vendorId}`);
}

export async function revokeVendorCategory(accessId: string, vendorId: string) {
  const actor = await requirePermission(PERMISSIONS.VENDOR_MANAGE);
  await db.delete(vendorCategoryAccess).where(eq(vendorCategoryAccess.id, accessId));
  await recordAudit({ actor, action: "vendor.category_access_revoked", entityType: "vendor", entityId: vendorId });
  revalidatePath(`/vendors/${vendorId}`);
}
