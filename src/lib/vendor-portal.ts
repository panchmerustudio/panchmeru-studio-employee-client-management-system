import "server-only";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { vendorAssignments, vendorCategoryAccess, vendorActivities, documents, documentVersions, documentCategories, files, projects, sites } from "@/db/schema";

/**
 * Vendor-portal read models (src/app/vendor/**). Unlike the client
 * portal (individual drawings shared one at a time via
 * clientDrawingShares), a vendor's visibility is STRUCTURAL: every query
 * here MUST intersect {vendor's assigned project(s)} with {vendor's
 * granted document category(ies)} — that intersection is the only thing
 * standing between one vendor and drawings outside their trade/project
 * (see getCurrentVendor()/requireVendor() in vendor-auth.ts for how
 * vendorId itself is established).
 */

export type VendorScope = { projectIds: string[]; categoryIds: string[] };

export async function getVendorScope(vendorId: string): Promise<VendorScope> {
  const assignments = await db.query.vendorAssignments.findMany({ where: eq(vendorAssignments.vendorId, vendorId) });
  const access = await db.query.vendorCategoryAccess.findMany({ where: eq(vendorCategoryAccess.vendorId, vendorId) });
  return {
    projectIds: Array.from(new Set(assignments.map((a) => a.projectId))),
    categoryIds: Array.from(new Set(access.map((a) => a.documentCategoryId))),
  };
}

export type VendorDrawingRow = {
  documentId: string;
  documentName: string;
  categoryKey: string | null;
  categoryName: string | null;
  projectName: string | null;
  siteName: string | null;
  versionId: string;
  versionNumber: number;
  versionStatus: string;
  updatedAt: Date;
  fileId: string;
  mimeType: string;
};

/**
 * Every document in the vendor's granted categories, on a project they're
 * assigned to — latest non-draft version only (a "draft" hasn't cleared
 * internal review, so it stays internal even from an in-scope vendor).
 */
export async function getVendorDrawings(vendorId: string): Promise<VendorDrawingRow[]> {
  const scope = await getVendorScope(vendorId);
  if (scope.projectIds.length === 0 || scope.categoryIds.length === 0) return [];

  const docs = await db
    .select({
      documentId: documents.id,
      documentName: documents.name,
      categoryKey: documentCategories.key,
      categoryName: documentCategories.name,
      projectName: projects.name,
      siteName: sites.name,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId))
    .leftJoin(projects, eq(projects.id, documents.projectId))
    .leftJoin(sites, eq(sites.id, documents.siteId))
    .where(and(inArray(documents.projectId, scope.projectIds), inArray(documents.categoryId, scope.categoryIds)));

  const rows: VendorDrawingRow[] = [];
  for (const d of docs) {
    const versions = await db.query.documentVersions.findMany({
      where: eq(documentVersions.documentId, d.documentId),
      orderBy: (v, { desc }) => desc(v.versionNumber),
    });
    const latest = versions.find((v) => v.status !== "draft");
    if (!latest) continue;
    const file = await db.query.files.findFirst({ where: eq(files.id, latest.fileId) });
    if (!file) continue;
    rows.push({
      documentId: d.documentId,
      documentName: d.documentName,
      categoryKey: d.categoryKey,
      categoryName: d.categoryName,
      projectName: d.projectName,
      siteName: d.siteName,
      versionId: latest.id,
      versionNumber: latest.versionNumber,
      versionStatus: latest.status,
      updatedAt: d.updatedAt,
      fileId: file.id,
      mimeType: file.mimeType,
    });
  }
  return rows.sort((a, b) => a.documentName.localeCompare(b.documentName));
}

export async function getVendorDrawingByVersionId(vendorId: string, versionId: string): Promise<VendorDrawingRow | null> {
  const all = await getVendorDrawings(vendorId);
  return all.find((d) => d.versionId === versionId) ?? null;
}

/**
 * Used by /api/files/[id] to decide whether a vendor session may read a
 * given file — re-derives scope from the DB rather than trusting anything
 * client-supplied, same pattern as the client-portal branch there.
 */
export async function findVendorAccessibleVersion(vendorId: string, fileId: string) {
  const version = await db.query.documentVersions.findFirst({ where: eq(documentVersions.fileId, fileId) });
  if (!version || version.status === "draft") return null;
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, version.documentId) });
  if (!doc || !doc.projectId || !doc.categoryId) return null;
  const scope = await getVendorScope(vendorId);
  if (!scope.projectIds.includes(doc.projectId) || !scope.categoryIds.includes(doc.categoryId)) return null;
  return { version, doc };
}

export async function getVendorActivity(vendorId: string, limit = 15) {
  return db.query.vendorActivities.findMany({
    where: eq(vendorActivities.vendorId, vendorId),
    orderBy: (a, { desc }) => desc(a.createdAt),
    limit,
  });
}
