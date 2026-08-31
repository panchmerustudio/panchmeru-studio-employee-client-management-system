import { notFound, redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { vendors, vendorUsers, vendorAssignments, vendorCategoryAccess, vendorActivities, documentCategories, projects, sites } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo } from "@/lib/format";
import { ResetPasswordForm } from "./reset-password-form";
import { ProjectAssignments } from "./project-assignments";
import { CategoryAccess } from "./category-access";
import { StatusToggle } from "./status-toggle";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERMISSIONS.VENDOR_MANAGE)) redirect("/documents");

  const vendor = await db.query.vendors.findFirst({ where: eq(vendors.id, id) });
  if (!vendor) notFound();

  const login = await db.query.vendorUsers.findFirst({ where: eq(vendorUsers.vendorId, id) });

  const assignmentRows = await db
    .select({
      id: vendorAssignments.id,
      projectId: vendorAssignments.projectId,
      projectName: projects.name,
      siteId: vendorAssignments.siteId,
      siteName: sites.name,
    })
    .from(vendorAssignments)
    .innerJoin(projects, eq(projects.id, vendorAssignments.projectId))
    .leftJoin(sites, eq(sites.id, vendorAssignments.siteId))
    .where(eq(vendorAssignments.vendorId, id));

  const accessRows = await db
    .select({ id: vendorCategoryAccess.id, documentCategoryId: vendorCategoryAccess.documentCategoryId, isDefault: vendorCategoryAccess.isDefault })
    .from(vendorCategoryAccess)
    .where(eq(vendorCategoryAccess.vendorId, id));

  const allCategories = await db.select({ id: documentCategories.id, name: documentCategories.name }).from(documentCategories).orderBy(documentCategories.name);
  const allProjects = await db.select({ id: projects.id, name: projects.name }).from(projects);
  const allSites = await db.select({ id: sites.id, name: sites.name, projectId: sites.projectId }).from(sites);

  const activity = await db.query.vendorActivities.findMany({ where: eq(vendorActivities.vendorId, id), orderBy: desc(vendorActivities.createdAt), limit: 25 });

  return (
    <div className="space-y-5">
      <PageHeader
        title={vendor.name}
        subtitle={vendor.category ?? undefined}
        action={<StatusToggle vendorId={vendor.id} status={vendor.status as "active" | "inactive"} />}
      />

      <SectionCard title="Profile" action={<Badge status={vendor.status} />}>
        <div className="space-y-1 text-sm">
          <div>Mobile: {vendor.mobile ?? "—"}</div>
          <div>Email: {vendor.email ?? "—"}</div>
          <div>Address: {vendor.address ?? "—"}</div>
        </div>
      </SectionCard>

      <SectionCard title="Portal login">
        {login ? (
          <div className="space-y-3">
            <div className="text-sm">
              <div>
                Email: <span className="font-mono">{login.email}</span>
              </div>
              <div className="text-xs text-muted">
                Status: {login.status} · last signed in {login.lastLoginAt ? timeAgo(login.lastLoginAt) : "never"}
              </div>
            </div>
            <ResetPasswordForm vendorUserId={login.id} />
          </div>
        ) : (
          <p className="text-sm text-muted">No portal login on this vendor yet.</p>
        )}
      </SectionCard>

      <SectionCard title="Assigned projects" action={<span className="text-xs text-muted">defines visibility, with category access below</span>}>
        <ProjectAssignments vendorId={vendor.id} assignments={assignmentRows} projects={allProjects} sites={allSites} />
      </SectionCard>

      <SectionCard title="Drawing category access" action={<span className="text-xs text-muted">section 22-23</span>}>
        <CategoryAccess vendorId={vendor.id} access={accessRows} categories={allCategories} />
      </SectionCard>

      <SectionCard title="Activity">
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
