import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { projects, cadModels } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, EmptyState, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo } from "@/lib/format";
import { UploadForm } from "./upload-form";

export default async function CadListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!project) notFound();

  const canCreate = user.permissions.includes(PERMISSIONS.CAD_CREATE);
  const models = await db.select().from(cadModels).where(eq(cadModels.projectId, id)).orderBy(desc(cadModels.createdAt));

  return (
    <div className="space-y-5">
      <PageHeader
        title="3D Modeler"
        subtitle={`${project.name} · AI CAD → 3D — CAD measurements stay locked, nothing here invents a dimension`}
        action={
          <Link href={`/projects/${id}`} className="btn btn-secondary">
            <Icon name="arrow-left" className="h-4 w-4" /> Back to project
          </Link>
        }
      />

      {canCreate && (
        <SectionCard title="Import a DXF drawing">
          <UploadForm projectId={id} />
        </SectionCard>
      )}

      <SectionCard title="Models">
        {models.length === 0 ? (
          <EmptyState icon="cube" title="No CAD imports yet" subtitle="Upload a DXF drawing above to generate an exact 3D model from it." />
        ) : (
          <div className="divide-y divide-border">
            {models.map((m) => (
              <Link key={m.id} href={`/projects/${id}/cad/${m.id}`} className="flex items-center justify-between gap-3 px-1 py-3.5 hover:bg-background">
                <div>
                  <div className="text-sm font-medium text-foreground">{m.name}</div>
                  <div className="text-xs text-muted">
                    {timeAgo(m.createdAt)} {m.entityCounts && `· ${Object.entries(m.entityCounts).map(([k, v]) => `${v} ${k}`).join(", ")}`}
                  </div>
                </div>
                <Badge status={m.status} />
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
