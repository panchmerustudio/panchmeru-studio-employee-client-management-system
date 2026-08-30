import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clientDrawingShares, documentVersions, documents, files as filesTable, clientActivities } from "@/db/schema";
import { getCurrentClient } from "@/lib/client-auth";
import { PageHeader } from "@/components/ui";
import { ProtectedViewer } from "@/components/protected-viewer";
import { LogoutButton } from "../logout-button";

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

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <PageHeader title={doc?.name ?? "Drawing"} subtitle={`Version ${version.versionNumber}`} action={<LogoutButton />} />
      <ProtectedViewer
        fileId={file.id}
        mimeType={file.mimeType}
        originalName={file.originalName}
        watermarkLines={[client.contactName ?? client.clientName, client.email]}
      />
    </div>
  );
}
