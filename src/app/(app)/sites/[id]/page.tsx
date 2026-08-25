import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@/db/client";
import { sites, projects, siteAssignments, employees, users, siteVisits, siteBoundaries, sitePhotos, webauthnCredentials, geofences, attendanceEvents } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge, EmptyState } from "@/components/ui";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { Icon } from "@/components/icon";
import { StartVisitButton } from "./start-visit-button";
import { AssignForm, RemoveAssignmentButton } from "./assign-form";

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const site = await db.query.sites.findFirst({ where: eq(sites.id, id) });
  if (!site) notFound();

  const project = await db.query.projects.findFirst({ where: eq(projects.id, site.projectId) });
  const geofence = site.geofenceId ? await db.query.geofences.findFirst({ where: eq(geofences.id, site.geofenceId) }) : null;

  const assignments = await db
    .select({ id: siteAssignments.id, employeeId: siteAssignments.employeeId, role: siteAssignments.role, name: users.name })
    .from(siteAssignments)
    .innerJoin(employees, eq(employees.id, siteAssignments.employeeId))
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(siteAssignments.siteId, id));

  const isAssigned = !!user.employeeId && assignments.some((a) => a.employeeId === user.employeeId);
  const canManage = user.permissions.includes(PERMISSIONS.SITE_MANAGE);
  const canVisit = user.permissions.includes(PERMISSIONS.SITE_VISIT);

  const myActiveVisit = user.employeeId
    ? await db.query.siteVisits.findFirst({ where: and(eq(siteVisits.employeeId, user.employeeId), eq(siteVisits.status, "active")) })
    : null;

  const visits = await db
    .select({
      id: siteVisits.id,
      employeeId: siteVisits.employeeId,
      startedAt: siteVisits.startedAt,
      endedAt: siteVisits.endedAt,
      status: siteVisits.status,
      name: users.name,
      checkInEventId: siteVisits.checkInEventId,
      checkOutEventId: siteVisits.checkOutEventId,
    })
    .from(siteVisits)
    .innerJoin(employees, eq(employees.id, siteVisits.employeeId))
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(siteVisits.siteId, id))
    .orderBy(desc(siteVisits.startedAt))
    .limit(10);

  const visitLocations = canManage
    ? await Promise.all(
        visits.map(async (v) => {
          const checkIn = v.checkInEventId ? await db.query.attendanceEvents.findFirst({ where: eq(attendanceEvents.id, v.checkInEventId) }) : null;
          return { visitId: v.id, address: checkIn?.address ?? null, withinGeofence: checkIn?.withinGeofence ?? null, distanceMeters: checkIn?.distanceMeters ?? null };
        })
      )
    : [];

  const boundary = await db.query.siteBoundaries.findFirst({ where: eq(siteBoundaries.siteId, id), orderBy: (b, { desc: d }) => d(b.createdAt) });
  const photos = await db.select().from(sitePhotos).where(eq(sitePhotos.siteId, id)).orderBy(desc(sitePhotos.createdAt)).limit(9);

  const allEmployees = await db
    .select({ id: employees.id, name: users.name })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.status, "active"));
  const unassigned = allEmployees.filter((e) => !assignments.some((a) => a.employeeId === e.id));

  const cred = user.employeeId ? await db.query.webauthnCredentials.findFirst({ where: eq(webauthnCredentials.userId, user.id) }) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={site.name}
        subtitle={`${project?.name ?? ""} · ${site.city}${site.addressLine ? ` · ${site.addressLine}` : ""}`}
        action={
          <div className="flex gap-2">
            <Badge status={site.status} />
            <Badge status={site.healthStatus} />
          </div>
        }
      />

      {site.healthReason && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <Icon name="alert" className="mr-1 inline h-4 w-4" /> {site.healthReason}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-3">
        <div className="space-y-5 md:col-span-2">
          <SectionCard title="Overview">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Info label="Start date" value={formatDate(site.startDate)} />
              <Info label="Expected completion" value={formatDate(site.expectedCompletion)} />
              <Info label="Geofence radius" value={geofence ? `${geofence.radiusMeters} m` : "—"} />
              <Info label="Coordinates" value={site.latitude ? `${site.latitude.toFixed(5)}, ${site.longitude?.toFixed(5)}` : "—"} />
            </dl>
          </SectionCard>

          <SectionCard title="Assigned team">
            {assignments.length === 0 ? (
              <p className="mb-3 text-sm text-muted">No one assigned yet.</p>
            ) : (
              <ul className="mb-1 divide-y divide-border">
                {assignments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{a.name} <span className="text-xs text-muted">· {(a.role ?? "team_member").replace("_", " ")}</span></span>
                    {canManage && <RemoveAssignmentButton assignmentId={a.id} siteId={id} />}
                  </li>
                ))}
              </ul>
            )}
            {canManage && <AssignForm siteId={id} employees={unassigned} />}
          </SectionCard>

          <SectionCard title="Visit history" action={<Link href={`/sites/${id}/boundary`} className="text-xs font-medium text-accent">Map boundary</Link>}>
            {visits.length === 0 ? (
              <EmptyState icon="map-pin" title="No visits recorded yet" />
            ) : (
              <ul className="divide-y divide-border">
                {visits.map((v) => {
                  const loc = visitLocations.find((l) => l.visitId === v.id);
                  return (
                    <li key={v.id} className="py-2.5 text-sm">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{v.name}</div>
                          <div className="text-xs text-muted">
                            {formatDateTime(v.startedAt)} {v.endedAt ? `→ ${formatDateTime(v.endedAt)}` : ""}
                          </div>
                        </div>
                        <Badge status={v.status} />
                      </div>
                      {loc?.address && (
                        <div className="mt-1 flex items-start gap-1.5 text-[11px] text-muted">
                          <span className={loc.withinGeofence ? "text-emerald-600" : "text-red-600"}>{loc.withinGeofence ? "✓" : "⚠"}</span>
                          <span>
                            Checked in at {loc.address}
                            {loc.distanceMeters != null && ` · ${Math.round(loc.distanceMeters)}m from site`}
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          {photos.length > 0 && (
            <SectionCard title="Site photos">
              <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
                {photos.map((p) => (
                  <a key={p.id} href={`/api/files/${p.fileId}`} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-border">
                    <img src={`/api/files/${p.fileId}`} alt={p.caption ?? "site photo"} className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        <div className="space-y-5">
          {myActiveVisit ? (
            <SectionCard>
              <Link href={`/sites/${id}/visit`} className="btn btn-primary w-full">
                <Icon name="map-pin" className="h-4 w-4" /> Resume active visit
              </Link>
            </SectionCard>
          ) : (
            canVisit && (isAssigned || canManage) && site.status === "active" && (
              <SectionCard title="Site visit">
                <StartVisitButton siteId={id} hasBiometric={!!cred} />
              </SectionCard>
            )
          )}

          <SectionCard title="Boundary">
            {boundary ? (
              <div className="text-sm">
                <p>Area: <strong>{boundary.areaSqFt?.toLocaleString()} sq ft</strong></p>
                <p>Perimeter: <strong>{boundary.perimeterFt?.toLocaleString()} ft</strong></p>
                <p className="mt-2 text-xs text-muted">Captured {timeAgo(boundary.createdAt)} — GPS approximate, not a legal survey.</p>
                <Link href={`/sites/${id}/boundary`} className="btn btn-secondary mt-3 w-full">Re-map boundary</Link>
              </div>
            ) : (
              <div>
                <p className="mb-3 text-sm text-muted">No boundary captured yet.</p>
                <Link href={`/sites/${id}/boundary`} className="btn btn-secondary w-full">
                  <Icon name="ruler" className="h-4 w-4" /> Map boundary
                </Link>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}
