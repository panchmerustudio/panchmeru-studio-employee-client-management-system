import { notFound, redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, users, attendanceEvents } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge } from "@/components/ui";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { getEmployeeRecentSiteVisits, getSiteVisitTrail } from "@/lib/location-tracking";
import { LocationTrailMapClient } from "@/components/location-trail-map-client";

export default async function EmployeeLocationHistoryPage({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ visit?: string }> }) {
  const { employeeId } = await params;
  const { visit: visitParam } = await searchParams;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERMISSIONS.ATTENDANCE_VIEW_ALL)) redirect("/dashboard");

  const employee = await db
    .select({ id: employees.id, name: users.name })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, employeeId))
    .then((r) => r[0]);
  if (!employee) notFound();

  const visits = await getEmployeeRecentSiteVisits(employeeId, 15);
  const selectedVisit = visitParam ? visits.find((v) => v.id === visitParam) : visits[0];
  const trail = selectedVisit ? await getSiteVisitTrail(selectedVisit.id) : [];

  const recentEvents = await db
    .select({
      id: attendanceEvents.id,
      type: attendanceEvents.type,
      source: attendanceEvents.source,
      withinGeofence: attendanceEvents.withinGeofence,
      capturedAtClient: attendanceEvents.capturedAtClient,
      address: attendanceEvents.address,
    })
    .from(attendanceEvents)
    .where(eq(attendanceEvents.employeeId, employeeId))
    .orderBy(desc(attendanceEvents.capturedAtClient))
    .limit(20);

  return (
    <div className="space-y-5">
      <PageHeader title={`${employee.name} — Location history`} subtitle="Linked to site visits and attendance check-in/out records." />

      <SectionCard title={selectedVisit ? `${selectedVisit.siteName} · ${formatDate(selectedVisit.startedAt)}` : "No site visits yet"}>
        {trail.length > 0 ? (
          <LocationTrailMapClient points={trail.map((p) => ({ latitude: p.latitude, longitude: p.longitude, recordedAt: p.recordedAt.toISOString() }))} />
        ) : (
          <p className="text-sm text-muted">No GPS points recorded for this visit.</p>
        )}
      </SectionCard>

      {visits.length > 1 && (
        <SectionCard title="Recent site visits">
          <ul className="divide-y divide-border">
            {visits.map((v) => (
              <li key={v.id} className="flex items-center justify-between py-2 text-sm">
                <a href={`/live-locations/${employeeId}?visit=${v.id}`} className={`font-medium ${selectedVisit?.id === v.id ? "text-brand-ink" : "text-foreground"} hover:underline`}>
                  {v.siteName} · {formatDate(v.startedAt)}
                </a>
                <Badge status={v.status} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="Check-in / check-out history">
        {recentEvents.length === 0 ? (
          <p className="text-sm text-muted">No attendance events recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recentEvents.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">
                    {e.type === "check_in" ? "Check-in" : "Check-out"} · {e.source} · {formatTime(e.capturedAtClient)}
                  </div>
                  <div className="text-xs text-muted">
                    {formatDateTime(e.capturedAtClient)} {e.address ? `· ${e.address}` : ""}
                  </div>
                </div>
                {!e.withinGeofence && <span className="badge bg-red-100 text-red-700">Outside geofence</span>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
