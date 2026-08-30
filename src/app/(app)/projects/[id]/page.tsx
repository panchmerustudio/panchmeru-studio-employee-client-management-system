import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { projects, projectTypes, projectMilestones, projectMembers, employees, users, sites } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { formatDate } from "@/lib/format";
import { StatusSelect } from "./status-select";
import { Milestones } from "./milestones";
import { Members } from "./members";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!project) notFound();

  const type = project.projectTypeId ? await db.query.projectTypes.findFirst({ where: eq(projectTypes.id, project.projectTypeId) }) : null;

  const milestoneRows = await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, id)).orderBy(projectMilestones.dueDate);

  const memberRows = await db
    .select({ id: projectMembers.id, employeeId: projectMembers.employeeId, roleOnProject: projectMembers.roleOnProject, name: users.name })
    .from(projectMembers)
    .innerJoin(employees, eq(employees.id, projectMembers.employeeId))
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(projectMembers.projectId, id));

  const siteRows = await db.select({ id: sites.id, name: sites.name, status: sites.status, healthStatus: sites.healthStatus }).from(sites).where(eq(sites.projectId, id));

  const canManage = user.permissions.includes(PERMISSIONS.SITE_MANAGE);

  const allEmployees = canManage
    ? await db
        .select({ id: employees.id, name: users.name })
        .from(employees)
        .innerJoin(users, eq(users.id, employees.userId))
        .where(eq(employees.status, "active"))
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={project.name}
        subtitle={`${type?.name ?? "General"} · ${formatDate(project.startDate)} – ${formatDate(project.expectedCompletion)}`}
        action={canManage ? <StatusSelect projectId={id} status={project.status} /> : <Badge status={project.status} />}
      />

      <div className="grid gap-5 md:grid-cols-3">
        <div className="space-y-5 md:col-span-2">
          <SectionCard title="Milestones">
            {canManage ? (
              <Milestones projectId={id} milestones={milestoneRows} />
            ) : milestoneRows.length === 0 ? (
              <p className="text-sm text-muted">No milestones yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {milestoneRows.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <div className="font-medium">{m.name}</div>
                      {m.dueDate && <div className="text-xs text-muted">Due {formatDate(m.dueDate)}</div>}
                    </div>
                    <Badge status={m.status} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Team">
            {canManage ? (
              <Members projectId={id} members={memberRows} employees={allEmployees} />
            ) : memberRows.length === 0 ? (
              <p className="text-sm text-muted">No team members assigned yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {memberRows.map((m) => (
                  <li key={m.id} className="py-2 text-sm">
                    {m.name} {m.roleOnProject && <span className="text-xs text-muted">· {m.roleOnProject}</span>}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard title="Sites">
            {siteRows.length === 0 ? (
              <EmptyState icon="map" title="No sites linked yet" />
            ) : (
              <ul className="divide-y divide-border">
                {siteRows.map((s) => (
                  <li key={s.id}>
                    <Link href={`/sites/${s.id}`} className="flex items-center justify-between py-2 text-sm hover:opacity-80">
                      <span>{s.name}</span>
                      <Badge status={s.healthStatus} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {user.permissions.includes(PERMISSIONS.CAD_CREATE) && (
            <SectionCard title="3D Modeler">
              <p className="mb-3 text-xs text-muted">Turn a DXF drawing into an exact, editable 3D model — CAD measurements stay locked.</p>
              <Link href={`/projects/${id}/cad`} className="btn btn-secondary w-full">
                <Icon name="cube" className="h-4 w-4" /> Open 3D Modeler
              </Link>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
