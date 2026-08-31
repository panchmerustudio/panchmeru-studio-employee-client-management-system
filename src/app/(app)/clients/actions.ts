"use server";

import { randomBytes } from "crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, clientContacts, clientUsers, clientDrawingShares, clientActivities, clientRevisionRequests, documentVersions, documents } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { hashClientPassword } from "@/lib/client-auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

function generateTempPassword() {
  // Readable-ish, avoids ambiguous characters — shown once, meant to be typed by hand on first login.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const createSchema = z.object({
  name: z.string().min(2, "Give the client a name."),
  email: z.string().email("A valid email is needed for their portal login."),
  mobile: z.string().optional(),
  companyName: z.string().optional(),
});

export type CreateClientState = { error?: string; ok?: boolean; clientId?: string; tempPassword?: string; loginEmail?: string };

export async function createClient(_prev: CreateClientState, formData: FormData): Promise<CreateClientState> {
  const actor = await requirePermission(PERMISSIONS.CLIENT_MANAGE).catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const data = parsed.data;
  const email = data.email.trim().toLowerCase();

  const existing = await db.query.clientUsers.findFirst({ where: eq(clientUsers.email, email) });
  if (existing) return { error: "A client login with this email already exists." };

  const [client] = await db
    .insert(clients)
    .values({ name: data.name, companyName: data.companyName || null, mobile: data.mobile || null, email, communicationPreference: "portal" })
    .returning();

  const [contact] = await db
    .insert(clientContacts)
    .values({ clientId: client.id, name: data.name, relationship: "owner", mobile: data.mobile || null, email, isPrimary: true })
    .returning();

  const tempPassword = generateTempPassword();
  await db.insert(clientUsers).values({
    clientId: client.id,
    clientContactId: contact.id,
    email,
    passwordHash: await hashClientPassword(tempPassword),
    status: "active",
  });

  await recordAudit({ actor, action: "client.created", entityType: "client", entityId: client.id, newState: { name: data.name, email } });
  revalidatePath("/clients");
  return { ok: true, clientId: client.id, tempPassword, loginEmail: email };
}

export type ResetPasswordState = { error?: string; ok?: boolean; tempPassword?: string };

export async function resetClientPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const actor = await requirePermission(PERMISSIONS.CLIENT_MANAGE).catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const clientUserId = formData.get("clientUserId") as string;
  const cu = await db.query.clientUsers.findFirst({ where: eq(clientUsers.id, clientUserId) });
  if (!cu) return { error: "Client login not found." };

  const tempPassword = generateTempPassword();
  await db.update(clientUsers).set({ passwordHash: await hashClientPassword(tempPassword), status: "active" }).where(eq(clientUsers.id, clientUserId));

  await recordAudit({ actor, action: "client.password_reset", entityType: "client_user", entityId: clientUserId });
  revalidatePath(`/clients/${cu.clientId}`);
  return { ok: true, tempPassword };
}

export async function shareDocumentWithClient(documentVersionId: string, clientId: string) {
  const actor = await requirePermission(PERMISSIONS.CLIENT_MANAGE);

  const version = await db.query.documentVersions.findFirst({ where: eq(documentVersions.id, documentVersionId) });
  if (!version) throw new Error("Document version not found.");
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, version.documentId) });

  const [share] = await db
    .insert(clientDrawingShares)
    .values({
      documentVersionId,
      clientId,
      projectId: doc?.projectId ?? null,
      siteId: doc?.siteId ?? null,
      sharedByUserId: actor.id,
      sharedByRole: actor.roleKey === "owner" || actor.roleKey === "manager" ? "owner_manager" : "employee",
    })
    .returning();

  await db.update(documentVersions).set({ status: "sent_to_client", visibility: "client_visible" }).where(eq(documentVersions.id, documentVersionId));

  await db.insert(clientActivities).values({
    clientId,
    projectId: doc?.projectId ?? null,
    activityType: "drawing_shared",
    description: `${doc?.name ?? "A drawing"} (v${version.versionNumber}) was shared by ${actor.name}.`,
    relatedEntityType: "client_drawing_share",
    relatedEntityId: share.id,
  });

  await recordAudit({ actor, action: "document.shared_with_client", entityType: "document_version", entityId: documentVersionId, newState: { clientId } });
  revalidatePath(`/documents/${version.documentId}`);
  revalidatePath(`/clients/${clientId}`);
  return share;
}

const REVISION_REQUEST_STATUSES = ["open", "assigned", "revised", "resent", "approved", "rejected"] as const;
type RevisionRequestStatus = (typeof REVISION_REQUEST_STATUSES)[number];

export async function assignRevisionRequest(requestId: string, employeeId: string | null) {
  const actor = await requirePermission(PERMISSIONS.CLIENT_MANAGE);
  const request = await db.query.clientRevisionRequests.findFirst({ where: eq(clientRevisionRequests.id, requestId) });
  if (!request) throw new Error("Revision request not found.");

  await db
    .update(clientRevisionRequests)
    .set({ assignedEmployeeId: employeeId || null, status: employeeId && request.status === "open" ? "assigned" : request.status })
    .where(eq(clientRevisionRequests.id, requestId));

  await recordAudit({ actor, action: "client.revision_request_assigned", entityType: "client_revision_request", entityId: requestId, newState: { employeeId } });
  revalidatePath("/clients/revision-requests");
}

export async function setRevisionRequestStatus(requestId: string, status: RevisionRequestStatus) {
  const actor = await requirePermission(PERMISSIONS.CLIENT_MANAGE);
  if (!REVISION_REQUEST_STATUSES.includes(status)) throw new Error("Invalid status.");

  const request = await db.query.clientRevisionRequests.findFirst({ where: eq(clientRevisionRequests.id, requestId) });
  if (!request) throw new Error("Revision request not found.");

  await db
    .update(clientRevisionRequests)
    .set({ status, resubmissionDate: status === "resent" ? new Date() : request.resubmissionDate })
    .where(eq(clientRevisionRequests.id, requestId));

  if (status === "revised" || status === "resent") {
    await db.insert(clientActivities).values({
      clientId: request.clientId,
      activityType: status === "revised" ? "revised_version_uploaded" : "revision_resent",
      description: `Revision request #${String(request.sequenceNumber).padStart(3, "0")} is now ${status === "revised" ? "revised internally" : "resent to you"}.`,
      relatedEntityType: "client_revision_request",
      relatedEntityId: requestId,
    });
  }

  await recordAudit({ actor, action: "client.revision_request_status_changed", entityType: "client_revision_request", entityId: requestId, newState: { status } });
  revalidatePath("/clients/revision-requests");
}
