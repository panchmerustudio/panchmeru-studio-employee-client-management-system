import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { projects, projectTypes, sites } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { formatDate } from "@/lib/format";

export default async function ProjectsPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  const canManage = user.permissions.includes(PERMISSIONS.SITE_MANAGE);

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      typeName: projectTypes.name,
      startDate: projects.startDate,
      expectedCompletion: projects.expectedCompletion,
    })
    .from(projects)
    .leftJoin(projectTypes, eq(projectTypes.id, projects.projectTypeId));

  const siteCounts = await db.select({ projectId: sites.projectId, count: sql<number>`count(*)` }).from(sites).groupBy(sites.projectId);
  const countFor = (id: string) => siteCounts.find((s) => s.projectId === id)?.count ?? 0;

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${rows.length} project${rows.length === 1 ? "" : "s"}`}
        action={
          canManage && (
            <Link href="/projects/new" className="btn btn-accent">
              <Icon name="plus" className="h-4 w-4" /> New project
            </Link>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon="folder" title="No projects yet" />
      ) : (
        <div className="card divide-y divide-border">
          {rows.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between px-4 py-3.5 hover:bg-background">
              <div>
                <div className="text-sm font-medium text-foreground">{p.name}</div>
                <div className="text-xs text-muted">
                  {p.typeName ?? "General"} · {countFor(p.id)} site{countFor(p.id) === 1 ? "" : "s"} · {formatDate(p.startDate)} – {formatDate(p.expectedCompletion)}
                </div>
              </div>
              <Badge status={p.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
