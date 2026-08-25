import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sites, projects, siteAssignments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { SiteMapClient } from "@/components/site-map-client";

export default async function SitesPage({ searchParams }: { searchParams: Promise<{ city?: string; status?: string; health?: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  const { city, status, health } = await searchParams;

  const canViewAll = user.permissions.includes(PERMISSIONS.SITE_VIEW_ALL);
  const canManage = user.permissions.includes(PERMISSIONS.SITE_MANAGE);

  let rows = await db
    .select({
      id: sites.id,
      name: sites.name,
      city: sites.city,
      status: sites.status,
      healthStatus: sites.healthStatus,
      healthReason: sites.healthReason,
      latitude: sites.latitude,
      longitude: sites.longitude,
      projectName: projects.name,
    })
    .from(sites)
    .innerJoin(projects, eq(projects.id, sites.projectId));

  if (!canViewAll && user.employeeId) {
    const assigned = await db.select({ siteId: siteAssignments.siteId }).from(siteAssignments).where(eq(siteAssignments.employeeId, user.employeeId));
    const ids = new Set(assigned.map((a) => a.siteId));
    rows = rows.filter((r) => ids.has(r.id));
  }
  if (city) rows = rows.filter((r) => r.city === city);
  if (status) rows = rows.filter((r) => r.status === status);
  if (health) rows = rows.filter((r) => r.healthStatus === health);

  const cities = Array.from(new Set(rows.map((r) => r.city))).sort();
  const mapSites = rows.filter((r) => r.latitude != null && r.longitude != null).map((r) => ({ id: r.id, name: r.name, city: r.city, latitude: r.latitude!, longitude: r.longitude!, healthStatus: r.healthStatus as "normal" | "attention" | "urgent" }));

  return (
    <div>
      <PageHeader
        title="Sites"
        subtitle={`${rows.length} site${rows.length === 1 ? "" : "s"}`}
        action={
          canManage && (
            <Link href="/sites/new" className="btn btn-accent">
              <Icon name="plus" className="h-4 w-4" /> Add site
            </Link>
          )
        }
      />

      <div className="mb-5">
        <SiteMapClient sites={mapSites} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <FilterLink label="All cities" active={!city} href="/sites" />
        {cities.map((c) => (
          <FilterLink key={c} label={c} active={city === c} href={`/sites?city=${encodeURIComponent(c)}`} />
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {["normal", "attention", "urgent"].map((h) => (
          <FilterLink key={h} label={h === "normal" ? "On track" : h === "attention" ? "Needs attention" : "Urgent"} active={health === h} href={`/sites?health=${h}`} />
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="map" title="No sites match these filters" />
      ) : (
        <div className="card divide-y divide-border">
          {rows.map((s) => (
            <Link key={s.id} href={`/sites/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-background">
              <div>
                <div className="text-sm font-medium text-foreground">{s.name}</div>
                <div className="text-xs text-muted">
                  {s.projectName} · {s.city} {s.healthReason ? `· ${s.healthReason}` : ""}
                </div>
              </div>
              <Badge status={s.healthStatus} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterLink({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <Link href={href} className={`badge whitespace-nowrap ${active ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}>
      {label}
    </Link>
  );
}
