import { notFound, redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, clientUsers, clientDrawingShares, documentVersions, documents } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge } from "@/components/ui";
import { timeAgo, statusLabel } from "@/lib/format";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERMISSIONS.CLIENT_MANAGE)) redirect("/documents");

  const client = await db.query.clients.findFirst({ where: eq(clients.id, id) });
  if (!client) notFound();

  const login = await db.query.clientUsers.findFirst({ where: eq(clientUsers.clientId, id) });

  const shares = await db
    .select({
      id: clientDrawingShares.id,
      viewStatus: clientDrawingShares.viewStatus,
      viewedAt: clientDrawingShares.viewedAt,
      responseStatus: clientDrawingShares.responseStatus,
      createdAt: clientDrawingShares.createdAt,
      versionNumber: documentVersions.versionNumber,
      documentName: documents.name,
    })
    .from(clientDrawingShares)
    .innerJoin(documentVersions, eq(documentVersions.id, clientDrawingShares.documentVersionId))
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(clientDrawingShares.clientId, id))
    .orderBy(desc(clientDrawingShares.createdAt));

  return (
    <div className="space-y-5">
      <PageHeader title={client.name} subtitle={client.companyName ?? undefined} />

      <SectionCard title="Portal login">
        {login ? (
          <div className="space-y-3">
            <div className="text-sm">
              <div>
                Email: <span className="font-mono">{login.email}</span>
              </div>
              <div className="text-xs text-muted">
                Status: {statusLabel(login.status)} · last signed in {login.lastLoginAt ? timeAgo(login.lastLoginAt) : "never"}
              </div>
            </div>
            <ResetPasswordForm clientUserId={login.id} />
          </div>
        ) : (
          <p className="text-sm text-muted">No portal login on this client yet.</p>
        )}
      </SectionCard>

      <SectionCard title="Shared drawings" action={<span className="text-xs text-muted">view-only — never downloadable by the client</span>}>
        {shares.length === 0 ? (
          <p className="text-sm text-muted">Nothing shared yet — share a document version from its detail page.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shares.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <div className="font-medium">
                    {s.documentName} · v{s.versionNumber}
                  </div>
                  <div className="text-xs text-muted">
                    Shared {timeAgo(s.createdAt)} {s.viewedAt ? `· viewed ${timeAgo(s.viewedAt)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge status={s.viewStatus} />
                  <Badge status={s.responseStatus} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
