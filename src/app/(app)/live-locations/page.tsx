import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, StatCard, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo, formatDateTime } from "@/lib/format";
import { getActiveSiteVisitLocations, getRecentLocations, getLocationExceptions } from "@/lib/location-tracking";
import { LiveLocationMapClient } from "@/components/live-location-map-client";
import type { LocationMarker } from "@/components/live-location-map";
import { ExceptionRow } from "./exception-row";

export default async function LiveLocationsPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERMISSIONS.ATTENDANCE_VIEW_ALL)) redirect("/dashboard");

  const live = await getActiveSiteVisitLocations();
  const excludeIds = new Set(live.map((l) => l.employeeId));
  const recent = await getRecentLocations(excludeIds);
  const exceptions = await getLocationExceptions(20);

  const activeEmployeeCount = (await db.select({ id: employees.id }).from(employees).where(eq(employees.status, "active"))).length;
  const trackedCount = new Set([...live.map((l) => l.employeeId), ...recent.map((r) => r.employeeId)]).size;
  const offlineCount = Math.max(0, activeEmployeeCount - trackedCount);

  const markers: LocationMarker[] = [
    ...live.map((l) => ({
      id: l.siteVisitId,
      employeeName: l.employeeName,
      label: l.siteName,
      latitude: l.latitude,
      longitude: l.longitude,
      color: l.status === "live" ? "#059669" : "#d97706",
      detail: l.status === "live" ? `Live · updated ${timeAgo(l.lastUpdatedAt)}` : `GPS gap · last update ${timeAgo(l.lastUpdatedAt)}`,
    })),
    ...recent.map((r) => ({
      id: `${r.employeeId}-recent`,
      employeeName: r.employeeName,
      label: r.context === "office" ? "Office" : (r.siteName ?? "Site"),
      latitude: r.latitude,
      longitude: r.longitude,
      color: "#64748b",
      detail: `Recent · ${timeAgo(r.lastUpdatedAt)}`,
    })),
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Live Employee Locations" subtitle="Tracked only during an active site visit or at check-in/out — never continuous or off-the-clock." />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Live" value={live.filter((l) => l.status === "live").length} icon="map-pin" tone="success" />
        <StatCard label="Recent" value={recent.length + live.filter((l) => l.status === "stale").length} icon="clock" tone="warning" />
        <StatCard label="Offline" value={offlineCount} icon="user" />
      </div>

      {markers.length === 0 ? (
        <EmptyState icon="map" title="No one is currently tracked" subtitle="A marker appears here while someone is on an active site visit, and briefly after a site visit ends or an office check-in." />
      ) : (
        <LiveLocationMapClient markers={markers} />
      )}

      <SectionCard title="On an active site visit">
        {live.length === 0 ? (
          <p className="text-sm text-muted">No one is on an active site visit right now.</p>
        ) : (
          <ul className="divide-y divide-border">
            {live.map((l) => (
              <li key={l.siteVisitId} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <Link href={`/live-locations/${l.employeeId}`} className="font-medium text-brand-ink underline">
                    {l.employeeName}
                  </Link>
                  <div className="text-xs text-muted">{l.siteName}</div>
                </div>
                <span className={`badge ${l.status === "live" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {l.status === "live" ? `Live · ${timeAgo(l.lastUpdatedAt)}` : `GPS gap · ${timeAgo(l.lastUpdatedAt)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Location exceptions" action={<span className="text-xs text-muted">outside geofence — for review, not accusation</span>}>
        {exceptions.length === 0 ? (
          <p className="text-sm text-muted">No out-of-geofence check-ins/outs recorded.</p>
        ) : (
          <ul className="divide-y divide-border">
            {exceptions.map((e) => (
              <li key={e.id} className="py-2.5">
                <div className="flex items-start justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium">
                      {e.employeeName} · {e.type === "check_in" ? "Check-in" : "Check-out"} ({e.source})
                    </div>
                    <div className="text-xs text-muted">
                      {formatDateTime(e.capturedAtClient)} {e.distanceMeters != null ? `· ${Math.round(e.distanceMeters)}m from geofence` : ""} {e.address ? `· ${e.address}` : ""}
                    </div>
                  </div>
                  {e.reviewed && <Icon name="check-circle" className="h-4 w-4 shrink-0 text-emerald-600" />}
                </div>
                <ExceptionRow attendanceEventId={e.id} reviewed={e.reviewed} note={e.reviewNote} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
