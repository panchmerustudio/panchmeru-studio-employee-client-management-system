"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clientDrawingShares, clientApprovals, clientRevisionRequests, clientActivities, documentVersions, documents, notifications } from "@/db/schema";
import { requireClient } from "@/lib/client-auth";
import { registerUploadedFile } from "@/lib/storage";
import { nextRevisionSequenceNumber } from "@/lib/client-portal";

/**
 * Mutations the client portal itself performs (approve / request revision).
 * Kept separate from src/app/(app)/clients/actions.ts, which is the STAFF
 * side (create a client login, share a drawing) — the two never overlap,
 * same split as client-auth.ts vs. auth.ts.
 *
 * There's no staff `recordAudit()` call here (that helper expects a staff
 * actor) — clientActivities is the audit trail for client-side actions,
 * which is exactly what it was built for (see future-client.ts).
 */

async function loadOwnedShare(shareId: string, clientId: string) {
  const share = await db.query.clientDrawingShares.findFirst({ where: eq(clientDrawingShares.id, shareId) });
  if (!share || share.clientId !== clientId) throw new Error("Drawing not found.");
  const version = await db.query.documentVersions.findFirst({ where: eq(documentVersions.id, share.documentVersionId) });
  if (!version) throw new Error("Drawing version not found.");
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, version.documentId) });
  return { share, version, doc };
}

/** Notify whoever's most likely to act on client feedback: the uploader of this version, plus the document's creator if different. */
async function notifyStaffOfClientAction(opts: { version: { uploadedBy: string }; doc: { createdBy: string } | undefined; type: string; title: string; message: string; documentId: string }) {
  const recipients = new Set([opts.version.uploadedBy]);
  if (opts.doc?.createdBy) recipients.add(opts.doc.createdBy);
  await db.insert(notifications).values(
    Array.from(recipients).map((recipientId) => ({
      recipientId,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      relatedEntityType: "document",
      relatedEntityId: opts.documentId,
    }))
  );
}

export async function approveDrawing(shareId: string) {
  const client = await requireClient();
  const { share, version, doc } = await loadOwnedShare(shareId, client.clientId);

  if (version.status === "approved") return; // already approved — idempotent, no double-record

  await db.insert(clientApprovals).values({
    documentVersionId: version.id,
    clientId: client.clientId,
    approvedByContactId: client.clientContactId,
    approvalMethod: "client_portal",
  });
  await db.update(documentVersions).set({ status: "approved" }).where(eq(documentVersions.id, version.id));
  await db.update(clientDrawingShares).set({ responseStatus: "approved" }).where(eq(clientDrawingShares.id, shareId));
  await db.insert(clientActivities).values({
    clientId: client.clientId,
    projectId: share.projectId,
    activityType: "approved",
    description: `${client.contactName ?? client.clientName} approved ${doc?.name ?? "a drawing"} (v${version.versionNumber}).`,
    relatedEntityType: "client_drawing_share",
    relatedEntityId: shareId,
  });

  await notifyStaffOfClientAction({
    version,
    doc,
    type: "client_drawing_approved",
    title: "Client approved a drawing",
    message: `${client.contactName ?? client.clientName} approved ${doc?.name ?? "a drawing"} (v${version.versionNumber}).`,
    documentId: version.documentId,
  });

  revalidatePath(`/client/${shareId}`);
  revalidatePath("/client");
  revalidatePath("/client/drawings");
  revalidatePath("/client/approved");
  if (doc) revalidatePath(`/documents/${doc.id}`);
}

function attachmentKind(mimeType: string): "photo" | "voice" | "document" {
  if (mimeType.startsWith("audio/")) return "voice";
  if (mimeType.startsWith("image/")) return "photo";
  return "document";
}

export async function requestRevision(shareId: string, formData: FormData) {
  const client = await requireClient();
  const { share, version, doc } = await loadOwnedShare(shareId, client.clientId);

  const requestText = (formData.get("requestText") as string | null)?.trim();
  if (!requestText) throw new Error("Please describe what needs to change.");

  const attachmentKey = formData.get("attachmentKey") as string | null;
  const attachmentMimeType = formData.get("attachmentMimeType") as string | null;
  const attachmentOriginalName = formData.get("attachmentOriginalName") as string | null;

  let attachmentFileId: string | undefined;
  if (attachmentKey && attachmentMimeType && attachmentOriginalName) {
    const saved = await registerUploadedFile({
      key: attachmentKey,
      originalName: attachmentOriginalName,
      mimeType: attachmentMimeType,
      kind: attachmentKind(attachmentMimeType),
      relatedEntityType: "client_revision_request",
    });
    attachmentFileId = saved.id;
  }

  const sequenceNumber = await nextRevisionSequenceNumber(client.clientId);
  const [request] = await db
    .insert(clientRevisionRequests)
    .values({
      sequenceNumber,
      documentVersionId: version.id,
      clientId: client.clientId,
      requestedByContactId: client.clientContactId,
      requestText,
      attachmentFileId,
      status: "open",
    })
    .returning();

  await db.update(documentVersions).set({ status: "client_revision_requested" }).where(eq(documentVersions.id, version.id));
  await db.update(clientDrawingShares).set({ responseStatus: "revision_requested" }).where(eq(clientDrawingShares.id, shareId));
  await db.insert(clientActivities).values({
    clientId: client.clientId,
    projectId: share.projectId,
    activityType: "revision_requested",
    description: `${client.contactName ?? client.clientName} requested a revision on ${doc?.name ?? "a drawing"} (v${version.versionNumber}): "${requestText.slice(0, 140)}"`,
    relatedEntityType: "client_revision_request",
    relatedEntityId: request.id,
  });

  await notifyStaffOfClientAction({
    version,
    doc,
    type: "client_revision_requested",
    title: "Client requested a revision",
    message: `${client.contactName ?? client.clientName} requested changes on ${doc?.name ?? "a drawing"} (v${version.versionNumber}) — #${String(sequenceNumber).padStart(3, "0")}.`,
    documentId: version.documentId,
  });

  revalidatePath(`/client/${shareId}`);
  revalidatePath("/client");
  revalidatePath("/client/drawings");
  revalidatePath("/client/revisions");
  if (doc) revalidatePath(`/documents/${doc.id}`);
}
