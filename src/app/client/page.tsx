import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clientDrawingShares, documentVersions, documents } from "@/db/schema";
import { getCurrentClient } from "@/lib/client-auth";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo } from "@/lib/format";
import { LogoutButton } from "./logout-button";

export default async function ClientPortalPage() {
  const client = await getCurrentClient();
  if (!client) redirect("/client/login");

  const shares = await db
    .select({
      id: clientDrawingShares.id,
      viewStatus: clientDrawingShares.viewStatus,
      createdAt: clientDrawingShares.createdAt,
      versionNumber: documentVersions.versionNumber,
      documentName: documents.name,
    })
    .from(clientDrawingShares)
    .innerJoin(documentVersions, eq(documentVersions.id, clientDrawingShares.documentVersionId))
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(clientDrawingShares.clientId, client.clientId))
    .orderBy(desc(clientDrawingShares.createdAt));

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <PageHeader title={`Welcome, ${client.contactName ?? client.clientName}`} subtitle={client.clientName} action={<LogoutButton />} />
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Drawings open in-app only, watermarked to you — there is no download here.
      </p>

      {shares.length === 0 ? (
        <EmptyState icon="file" title="Nothing shared yet" subtitle="Drawings your studio shares with you will show up here." />
      ) : (
        <div className="card divide-y divide-border">
          {shares.map((s) => (
            <Link key={s.id} href={`/client/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-background">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Icon name="file" className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {s.documentName} · v{s.versionNumber}
                  </div>
                  <div className="text-xs text-muted">Shared {timeAgo(s.createdAt)}</div>
                </div>
              </div>
              <Badge status={s.viewStatus} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
