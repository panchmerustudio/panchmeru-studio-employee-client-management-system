import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, users, attendanceRecords, attendanceEvents, siteVisits, sites } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { formatTime } from "@/lib/format";

export default async function TeamAttendancePage() {
  const viewer = await requirePermission(PERMISSIONS.ATTENDANCE_VIEW_ALL).catch(() => null);
  if (!viewer) redirect("/home");

  const today = new Date().toISOString().slice(0, 10);

  const allEmployees = await db
    .select({ id: employees.id, name: users.name, designation: employees.designation, city: employees.city })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.status, "active"));

  const records = await db.select().from(attendanceRecords).where(eq(attendanceRecords.date, today));
  const recordByEmployee = new Map(records.map((r) => [r.employeeId, r]));

  const activeVisits = await db
    .select({ employeeId: siteVisits.employeeId, siteName: sites.name })
    .from(siteVisits)
    .innerJoin(sites, eq(sites.id, siteVisits.siteId))
    .where(eq(siteVisits.status, "active"));
  const onSiteByEmployee = new Map(activeVisits.map((v) => [v.employeeId, v.siteName]));

  const present = allEmployees.filter((e) => recordByEmployee.get(e.id)?.status === "present");
  const onLeave = allEmployees.filter((e) => recordByEmployee.get(e.id)?.status === "on_leave");
  const absent = allEmployees.filter((e) => !recordByEmployee.has(e.id));

  async function checkInEventFor(eventId: string | null | undefined) {
    if (!eventId) return null;
    return db.query.attendanceEvents.findFirst({ where: eq(attendanceEvents.id, eventId) });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Team attendance" subtitle={`${present.length} present · ${absent.length} absent · ${onLeave.length} on leave today`} />

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-emerald-700">Present ({present.length})</h2>
          <div className="card divide-y divide-border">
            {present.length === 0 && <p className="p-4 text-sm text-muted">No one checked in yet.</p>}
            {await Promise.all(
              present.map(async (e) => {
                const rec = recordByEmployee.get(e.id);
                const event = await checkInEventFor(rec?.checkInEventId);
                const onSite = onSiteByEmployee.get(e.id);
                return (
                  <div key={e.id} className="px-3 py-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{e.name}</div>
                        <div className="text-xs text-muted">{e.designation}{e.city ? ` · ${e.city}` : ""}</div>
                      </div>
                      <div className="text-right text-xs text-muted">
                        {event && <div>{formatTime(event.capturedAtClient)}</div>}
                        {onSite && <div className="font-medium text-accent">On site: {onSite}</div>}
                      </div>
                    </div>
                    {event && (
                      <div className="mt-1.5 flex items-start gap-1.5 rounded bg-background px-2 py-1.5 text-[11px] text-muted">
                        <span className={event.withinGeofence ? "text-emerald-600" : "text-red-600"}>{event.withinGeofence ? "✓" : "⚠"}</span>
                        <span>
                          {event.address ?? `${event.latitude.toFixed(5)}, ${event.longitude.toFixed(5)}`}
                          {event.distanceMeters != null && ` · ${Math.round(event.distanceMeters)}m from geofence`}
                          {" · ±"}
                          {Math.round(event.accuracy)}m accuracy
                          {!event.withinGeofence && " · outside geofence"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-red-700">Absent ({absent.length})</h2>
          <div className="card divide-y divide-border">
            {absent.length === 0 && <p className="p-4 text-sm text-muted">Everyone is accounted for.</p>}
            {absent.map((e) => (
              <div key={e.id} className="px-3 py-2.5 text-sm">
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-muted">{e.designation}{e.city ? ` · ${e.city}` : ""}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-amber-700">On leave ({onLeave.length})</h2>
          <div className="card divide-y divide-border">
            {onLeave.length === 0 && <p className="p-4 text-sm text-muted">No one on leave today.</p>}
            {onLeave.map((e) => (
              <div key={e.id} className="px-3 py-2.5 text-sm">
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-muted">{e.designation}{e.city ? ` · ${e.city}` : ""}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
