import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, desc, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, clientUsers, clientDrawingShares, documentVersions, documents, projects } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo, statusLabel } from "@/lib/format";
import { getClientActivity } from "@/lib/client-portal";
import { ResetPasswordForm } from "./reset-password-form";
import { LinkProjectForm } from "./link-project-form";

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

  const activity = await getClientActivity(id, 25);

  const linkedProjects = await db.select({ id: projects.id, name: projects.name, status: projects.status }).from(projects).where(eq(projects.clientId, id));
  const unlinkedProjects = await db.select({ id: projects.id, name: projects.name }).from(projects).where(isNull(projects.clientId));

  return (
    <div className="space-y-5">
      <PageHeader
        title={client.name}
        subtitle={client.companyName ?? undefined}
        action={
          <Link href={`/clients/${id}/payments`} className="btn btn-secondary">
            <Icon name="chart" className="h-4 w-4" /> Payments
          </Link>
        }
      />

      <SectionCard title="Projects" action={<span className="text-xs text-muted">needed for payments & the client-visible vendor list</span>}>
        <LinkProjectForm clientId={id} linked={linkedProjects} unlinkedProjects={unlinkedProjects} />
      </SectionCard>

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

      <SectionCard title="Shared drawings" action={<span className="text-xs text-muted">downloadable once approved</span>}>
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

      <SectionCard title="Activity" action={<span className="text-xs text-muted">who shared/viewed/approved what, and when — section 17</span>}>
        {activity.length === 0 ? (
          <p className="text-sm text-muted">No activity recorded yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <Icon name="bell" className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-sm text-foreground">{a.description}</p>
                  <p className="text-xs text-muted">{timeAgo(a.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
