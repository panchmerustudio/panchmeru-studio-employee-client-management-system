import { notFound, redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { documents, documentVersions, documentCategories, projects, sites, users, files as filesTable } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { NewVersionForm } from "./new-version-form";
import { VersionViewer } from "./version-viewer";
import { ShareWithClient } from "./share-with-client";

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
  const canDownload = user.permissions.includes(PERMISSIONS.FILE_DOWNLOAD);
  const canShare = user.permissions.includes(PERMISSIONS.CLIENT_MANAGE);
  const watermarkLines = [user.name, user.email ?? user.phone ?? ""];

  const clients = canShare ? await db.query.clients.findMany({ orderBy: (c, { asc }) => asc(c.name) }) : [];

  return (
    <div className="space-y-5">
      <PageHeader title={doc.name} subtitle={[category?.name, project?.name, site?.name].filter(Boolean).join(" · ")} />
      {doc.description && <p className="text-sm text-muted">{doc.description}</p>}
      {!canDownload && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          In-app viewing only here — files are watermarked to you and can&apos;t be downloaded. Only the studio owner can save originals to a device.
        </p>
      )}

      <SectionCard title="Version history">
        <div className="space-y-3">
          {versions.map((v, i) => (
            <div key={v.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-600">V{v.versionNumber}</div>
                  <div>
                    <div className="text-sm font-medium">{versionFiles[i]?.originalName}</div>
                    <div className="text-xs text-muted">
                      {uploaders[i]?.name} · {timeAgo(v.createdAt)} {v.changeNote ? `· ${v.changeNote}` : ""}
                    </div>
                  </div>
                </div>
                <Badge status={v.status} />
              </div>
              <div className="mt-3 flex flex-wrap items-start gap-2">
                {versionFiles[i] && (
                  <VersionViewer
                    fileId={v.fileId}
                    mimeType={versionFiles[i]!.mimeType}
                    originalName={versionFiles[i]!.originalName}
                    watermarkLines={watermarkLines}
                    canDownload={canDownload}
                  />
                )}
                {canShare && <ShareWithClient documentVersionId={v.id} projectId={doc.projectId} siteId={doc.siteId} clients={clients.map((c) => ({ id: c.id, name: c.name }))} />}
              </div>
            </div>
          ))}
        </div>
        {canUpload && <NewVersionForm documentId={id} />}
      </SectionCard>
    </div>
  );
}
