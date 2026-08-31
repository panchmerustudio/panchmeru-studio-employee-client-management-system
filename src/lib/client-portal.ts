import "server-only";
import { eq, and, desc, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { clientDrawingShares, clientRevisionRequests, clientActivities, documentVersions, documents, documentCategories, files } from "@/db/schema";

/**
 * Client-portal read models (src/app/client/**). Everything here is scoped
 * to a single clientId — every query below MUST filter by it, since this
 * is the only thing standing between one client and another client's
 * drawings (see getCurrentClient()/requireClient() in client-auth.ts for
 * how clientId itself is established).
 */

export type ClientDrawingRow = {
  shareId: string;
  documentId: string;
  documentName: string;
  categoryKey: string | null;
  categoryName: string | null;
  versionId: string;
  versionNumber: number;
  versionStatus: string;
  responseStatus: string;
  viewStatus: string;
  sharedAt: Date;
  fileId: string;
  mimeType: string;
};

const drawingShareSelect = {
  shareId: clientDrawingShares.id,
  documentId: documents.id,
  documentName: documents.name,
  categoryKey: documentCategories.key,
  categoryName: documentCategories.name,
  versionId: documentVersions.id,
  versionNumber: documentVersions.versionNumber,
  versionStatus: documentVersions.status,
  responseStatus: clientDrawingShares.responseStatus,
  viewStatus: clientDrawingShares.viewStatus,
  sharedAt: clientDrawingShares.createdAt,
  fileId: files.id,
  mimeType: files.mimeType,
};

function drawingShareQuery() {
  return db
    .select(drawingShareSelect)
    .from(clientDrawingShares)
    .innerJoin(documentVersions, eq(documentVersions.id, clientDrawingShares.documentVersionId))
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(files, eq(files.id, documentVersions.fileId))
    .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId));
}

/** One row per document — the most-recently-shared version, so the library never shows the same drawing twice. */
export async function getClientDrawings(clientId: string): Promise<ClientDrawingRow[]> {
  const rows = await drawingShareQuery().where(eq(clientDrawingShares.clientId, clientId)).orderBy(desc(clientDrawingShares.createdAt));

  const byDocument = new Map<string, ClientDrawingRow>();
  for (const r of rows) {
    const existing = byDocument.get(r.documentId);
    if (!existing || r.versionNumber > existing.versionNumber) byDocument.set(r.documentId, r);
  }
  return Array.from(byDocument.values()).sort((a, b) => a.documentName.localeCompare(b.documentName));
}

export async function getClientApprovedDrawings(clientId: string): Promise<ClientDrawingRow[]> {
  const all = await getClientDrawings(clientId);
  return all.filter((d) => d.responseStatus === "approved");
}

/** Every client-visible version/share of one document, oldest first — the "never delete previous versions" history view. */
export async function getClientDrawingHistory(clientId: string, documentId: string): Promise<ClientDrawingRow[]> {
  return drawingShareQuery()
    .where(and(eq(clientDrawingShares.clientId, clientId), eq(documents.id, documentId)))
    .orderBy(asc(documentVersions.versionNumber));
}

export async function getClientDrawingByShareId(clientId: string, shareId: string): Promise<ClientDrawingRow | null> {
  const [row] = await drawingShareQuery().where(and(eq(clientDrawingShares.clientId, clientId), eq(clientDrawingShares.id, shareId))).limit(1);
  return row ?? null;
}

export type ClientRevisionRequestRow = {
  id: string;
  sequenceNumber: number;
  requestText: string;
  status: string;
  createdAt: Date;
  resubmissionDate: Date | null;
  documentName: string;
  versionNumber: number;
};

export async function getClientRevisionRequests(clientId: string): Promise<ClientRevisionRequestRow[]> {
  return db
    .select({
      id: clientRevisionRequests.id,
      sequenceNumber: clientRevisionRequests.sequenceNumber,
      requestText: clientRevisionRequests.requestText,
      status: clientRevisionRequests.status,
      createdAt: clientRevisionRequests.createdAt,
      resubmissionDate: clientRevisionRequests.resubmissionDate,
      documentName: documents.name,
      versionNumber: documentVersions.versionNumber,
    })
    .from(clientRevisionRequests)
    .innerJoin(documentVersions, eq(documentVersions.id, clientRevisionRequests.documentVersionId))
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(clientRevisionRequests.clientId, clientId))
    .orderBy(desc(clientRevisionRequests.createdAt));
}

export async function getClientRevisionRequestsForDocument(clientId: string, documentId: string): Promise<ClientRevisionRequestRow[]> {
  return db
    .select({
      id: clientRevisionRequests.id,
      sequenceNumber: clientRevisionRequests.sequenceNumber,
      requestText: clientRevisionRequests.requestText,
      status: clientRevisionRequests.status,
      createdAt: clientRevisionRequests.createdAt,
      resubmissionDate: clientRevisionRequests.resubmissionDate,
      documentName: documents.name,
      versionNumber: documentVersions.versionNumber,
    })
    .from(clientRevisionRequests)
    .innerJoin(documentVersions, eq(documentVersions.id, clientRevisionRequests.documentVersionId))
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(and(eq(clientRevisionRequests.clientId, clientId), eq(documents.id, documentId)))
    .orderBy(desc(clientRevisionRequests.createdAt));
}

export async function getClientActivity(clientId: string, limit = 15) {
  return db.query.clientActivities.findMany({
    where: eq(clientActivities.clientId, clientId),
    orderBy: desc(clientActivities.createdAt),
    limit,
  });
}

export async function nextRevisionSequenceNumber(clientId: string): Promise<number> {
  const existing = await db.query.clientRevisionRequests.findMany({ where: eq(clientRevisionRequests.clientId, clientId), columns: { id: true } });
  return existing.length + 1;
}
