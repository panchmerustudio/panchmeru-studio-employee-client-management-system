import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clientDrawingShares, documentVersions, documents, files as filesTable, clientActivities } from "@/db/schema";
import { getCurrentClient } from "@/lib/client-auth";
import { getClientDrawingHistory, getClientRevisionRequestsForDocument } from "@/lib/client-portal";
import { PageHeader, Badge } from "@/components/ui";
import { ProtectedViewer } from "@/components/protected-viewer";
import { timeAgo } from "@/lib/format";
import { LogoutButton } from "../logout-button";
import { ClientNav } from "../client-nav";
import { DrawingActions } from "./drawing-actions";

export default async function ClientSharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const client = await getCurrentClient();
  if (!client) redirect("/client/login");

  const share = await db.query.clientDrawingShares.findFirst({ where: eq(clientDrawingShares.id, shareId) });
  if (!share || share.clientId !== client.clientId) notFound();

  const version = await db.query.documentVersions.findFirst({ where: eq(documentVersions.id, share.documentVersionId) });
  if (!version) notFound();
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, version.documentId) });
  const file = await db.query.files.findFirst({ where: eq(filesTable.id, version.fileId) });
  if (!file) notFound();

  if (share.viewStatus === "not_viewed") {
    await db.update(clientDrawingShares).set({ viewStatus: "viewed", viewedAt: new Date() }).where(eq(clientDrawingShares.id, share.id));
    await db.insert(clientActivities).values({
      clientId: client.clientId,
      projectId: share.projectId,
      activityType: "client_viewed",
      description: `${client.contactName ?? client.clientName} viewed ${doc?.name ?? "a drawing"} (v${version.versionNumber}).`,
      relatedEntityType: "client_drawing_share",
      relatedEntityId: share.id,
    });
  }

  const [history, revisionRequests] = doc
    ? await Promise.all([getClientDrawingHistory(client.clientId, doc.id), getClientRevisionRequestsForDocument(client.clientId, doc.id)])
    : [[], []];

  const isApproved = version.status === "approved" || share.responseStatus === "approved";

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <PageHeader title={doc?.name ?? "Drawing"} subtitle={`Version ${version.versionNumber}`} action={<LogoutButton />} />

      <ProtectedViewer
        fileId={file.id}
        mimeType={file.mimeType}
        originalName={file.originalName}
        watermarkLines={[client.contactName ?? client.clientName, client.email]}
        downloadHref={isApproved ? `/api/files/${file.id}?download=1` : undefined}
      />

      <DrawingActions shareId={shareId} alreadyApproved={isApproved} />

      {history.length > 1 && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Version history</h3>
          <div className="space-y-2">
            {[...history].reverse().map((h) => (
              <a
                key={h.shareId}
                href={`/client/${h.shareId}`}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${h.shareId === shareId ? "bg-slate-100 font-medium" : "hover:bg-background"}`}
              >
                <span>
                  V{h.versionNumber} · Shared {timeAgo(h.sharedAt)}
                </span>
                <Badge status={h.responseStatus} />
              </a>
            ))}
          </div>
        </div>
      )}

      {revisionRequests.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Your revision requests on this drawing</h3>
          <div className="space-y-3">
            {revisionRequests.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-2 text-sm">
                <div>
                  <div className="font-medium text-foreground">#{String(r.sequenceNumber).padStart(3, "0")} · V{r.versionNumber}</div>
                  <p className="text-muted">{r.requestText}</p>
                  <p className="text-xs text-muted">{timeAgo(r.createdAt)}</p>
                </div>
                <Badge status={r.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      <ClientNav active="/client/drawings" />
    </div>
  );
}
