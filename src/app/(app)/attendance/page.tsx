import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { attendanceRecords, webauthnCredentials, attendanceEvents } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PageHeader, SectionCard, Badge } from "@/components/ui";
import { formatDate, formatTime } from "@/lib/format";
import { CheckInOut } from "./check-in-out";

export default async function AttendancePage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.employeeId) redirect("/home");

  const today = new Date().toISOString().slice(0, 10);
  const todayRecord = await db.query.attendanceRecords.findFirst({
    where: (r, { and, eq: eqOp }) => and(eqOp(r.employeeId, user.employeeId!), eqOp(r.date, today)),
  });

  const cred = await db.query.webauthnCredentials.findFirst({ where: eq(webauthnCredentials.userId, user.id) });

  const history = await db
    .select()
    .from(attendanceRecords)
    .where(eq(attendanceRecords.employeeId, user.employeeId))
    .orderBy(desc(attendanceRecords.date))
    .limit(14);

  const checkedIn = !!todayRecord?.checkInEventId && !todayRecord?.checkOutEventId;

  let checkInTime: Date | null = null;
  let checkOutTime: Date | null = null;
  if (todayRecord?.checkInEventId) {
    const ev = await db.query.attendanceEvents.findFirst({ where: eq(attendanceEvents.id, todayRecord.checkInEventId) });
    checkInTime = ev?.capturedAtClient ?? null;
  }
  if (todayRecord?.checkOutEventId) {
    const ev = await db.query.attendanceEvents.findFirst({ where: eq(attendanceEvents.id, todayRecord.checkOutEventId) });
    checkOutTime = ev?.capturedAtClient ?? null;
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PageHeader title="Attendance" subtitle={formatDate(new Date())} />

      <CheckInOut checkedIn={checkedIn} hasBiometric={!!cred} />

      {(checkInTime || checkOutTime) && (
        <SectionCard title="Today">
          <div className="flex justify-around text-center">
            <div>
              <div className="text-xs text-muted">Check-in</div>
              <div className="text-lg font-semibold">{checkInTime ? formatTime(checkInTime) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Check-out</div>
              <div className="text-lg font-semibold">{checkOutTime ? formatTime(checkOutTime) : "—"}</div>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Recent history">
        {history.length === 0 ? (
          <p className="text-sm text-muted">No attendance recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <span>{formatDate(h.date)}</span>
                <span className="flex items-center gap-2">
                  {h.totalMinutes ? <span className="text-xs text-muted">{(h.totalMinutes / 60).toFixed(1)}h</span> : null}
                  <Badge status={h.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {!cred && (
        <p className="text-center text-xs text-muted">
          Want faster check-ins? Register biometric sign-in from your <a href="/profile" className="font-medium text-accent">profile</a>.
        </p>
      )}
    </div>
  );
}
