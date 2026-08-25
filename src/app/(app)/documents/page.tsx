import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { documents, documentCategories, projects, sites, documentVersions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo } from "@/lib/format";

export default async function DocumentsPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const rows = await db
    .select({
      id: documents.id,
      name: documents.name,
      categoryName: documentCategories.name,
      projectName: projects.name,
      siteName: sites.name,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId))
    .leftJoin(projects, eq(projects.id, documents.projectId))
    .leftJoin(sites, eq(sites.id, documents.siteId))
    .orderBy(desc(documents.updatedAt));

  const latestVersions = await Promise.all(
    rows.map((r) => db.query.documentVersions.findFirst({ where: eq(documentVersions.documentId, r.id), orderBy: (v, { desc: d }) => d(v.versionNumber) }))
  );

  const canUpload = user.permissions.includes(PERMISSIONS.DOCUMENT_UPLOAD);

  return (
    <div>
      <PageHeader
        title="Documents & Drawings"
        subtitle={`${rows.length} document${rows.length === 1 ? "" : "s"}`}
        action={
          canUpload && (
            <Link href="/documents/new" className="btn btn-accent">
              <Icon name="plus" className="h-4 w-4" /> Upload
            </Link>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon="file" title="No documents yet" subtitle="Drawings, working documents and site photos will show up here, versioned automatically." />
      ) : (
        <div className="card divide-y divide-border">
          {rows.map((d, i) => (
            <Link key={d.id} href={`/documents/${d.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-background">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Icon name="file" className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{d.name}</div>
                  <div className="text-xs text-muted">
                    {d.categoryName ?? "Other"} {d.projectName ? `· ${d.projectName}` : ""} {d.siteName ? `· ${d.siteName}` : ""} · updated {timeAgo(d.updatedAt)}
                  </div>
                </div>
              </div>
              <span className="text-xs font-semibold text-muted">v{latestVersions[i]?.versionNumber ?? 1}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
