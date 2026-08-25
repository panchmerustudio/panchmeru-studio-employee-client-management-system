import { notFound, redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { documents, documentVersions, documentCategories, projects, sites, users, files as filesTable } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { Icon } from "@/components/icon";
import { NewVersionForm } from "./new-version-form";

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) });
  if (!doc) notFound();

  const category = doc.categoryId ? await db.query.documentCategories.findFirst({ where: eq(documentCategories.id, doc.categoryId) }) : null;
  const project = doc.projectId ? await db.query.projects.findFirst({ where: eq(projects.id, doc.projectId) }) : null;
  const site = doc.siteId ? await db.query.sites.findFirst({ where: eq(sites.id, doc.siteId) }) : null;

  const versions = await db.select().from(documentVersions).where(eq(documentVersions.documentId, id)).orderBy(desc(documentVersions.versionNumber));
  const uploaders = await Promise.all(versions.map((v) => db.query.users.findFirst({ where: eq(users.id, v.uploadedBy) })));
  const versionFiles = await Promise.all(versions.map((v) => db.query.files.findFirst({ where: eq(filesTable.id, v.fileId) })));

  const canUpload = user.permissions.includes(PERMISSIONS.DOCUMENT_UPLOAD);

  return (
    <div className="space-y-5">
      <PageHeader title={doc.name} subtitle={[category?.name, project?.name, site?.name].filter(Boolean).join(" · ")} />
      {doc.description && <p className="text-sm text-muted">{doc.description}</p>}

      <SectionCard title="Version history">
        <div className="space-y-3">
          {versions.map((v, i) => (
            <div key={v.id} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-600">V{v.versionNumber}</div>
                <div>
                  <div className="text-sm font-medium">{versionFiles[i]?.originalName}</div>
                  <div className="text-xs text-muted">
                    {uploaders[i]?.name} · {timeAgo(v.createdAt)} {v.changeNote ? `· ${v.changeNote}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={v.status} />
                <a href={`/api/files/${v.fileId}`} target="_blank" rel="noreferrer" className="btn btn-secondary">
                  <Icon name="file" className="h-4 w-4" /> Open
                </a>
              </div>
            </div>
          ))}
        </div>
        {canUpload && <NewVersionForm documentId={id} />}
      </SectionCard>
    </div>
  );
}
