import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { clientRevisionRequests, clients, documentVersions, documents, employees, users, files as filesTable } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState } from "@/components/ui";
import { RevisionRequestRow } from "./revision-request-row";

export default async function RevisionRequestsPage() {
  const actor = await requirePermission(PERMISSIONS.CLIENT_MANAGE).catch(() => null);
  if (!actor) redirect("/documents");

  const requests = await db
    .select({
      id: clientRevisionRequests.id,
      sequenceNumber: clientRevisionRequests.sequenceNumber,
      requestText: clientRevisionRequests.requestText,
      status: clientRevisionRequests.status,
      createdAt: clientRevisionRequests.createdAt,
      assignedEmployeeId: clientRevisionRequests.assignedEmployeeId,
      attachmentFileId: clientRevisionRequests.attachmentFileId,
      clientId: clients.id,
      clientName: clients.name,
      documentId: documents.id,
      documentName: documents.name,
      versionNumber: documentVersions.versionNumber,
    })
    .from(clientRevisionRequests)
    .innerJoin(clients, eq(clients.id, clientRevisionRequests.clientId))
    .innerJoin(documentVersions, eq(documentVersions.id, clientRevisionRequests.documentVersionId))
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .orderBy(desc(clientRevisionRequests.createdAt));

  const employeeRows = await db
    .select({ id: employees.id, name: users.name })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.status, "active"));

  const attachmentIds = requests.map((r) => r.attachmentFileId).filter((id): id is string => !!id);
  const attachmentRows =
    attachmentIds.length > 0 ? await db.select({ id: filesTable.id, mimeType: filesTable.mimeType }).from(filesTable).where(inArray(filesTable.id, attachmentIds)) : [];
  const attachmentTypeById = new Map(attachmentRows.map((f) => [f.id, f.mimeType]));

  const open = requests.filter((r) => !["approved", "rejected"].includes(r.status));
  const closed = requests.filter((r) => ["approved", "rejected"].includes(r.status));

  return (
    <div className="space-y-5">
      <PageHeader title="Revision Requests" subtitle="Client-requested drawing changes, internal review queue" />

      {requests.length === 0 ? (
        <EmptyState icon="edit" title="No revision requests yet" subtitle="When a client requests a change on a shared drawing, it'll show up here." />
      ) : (
        <>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Open ({open.length})</h2>
            <div className="space-y-2">
              {open.map((r) => (
                <RevisionRequestRow key={r.id} request={r} employees={employeeRows} attachmentMimeType={r.attachmentFileId ? attachmentTypeById.get(r.attachmentFileId) : undefined} />
              ))}
            </div>
          </div>
          {closed.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Closed ({closed.length})</h2>
              <div className="space-y-2">
                {closed.map((r) => (
                  <RevisionRequestRow key={r.id} request={r} employees={employeeRows} attachmentMimeType={r.attachmentFileId ? attachmentTypeById.get(r.attachmentFileId) : undefined} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
