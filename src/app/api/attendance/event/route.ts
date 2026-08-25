import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { recordAttendanceEvent, AttendanceError } from "@/lib/attendance-service";
import { PERMISSIONS } from "@/lib/rbac";

const schema = z.object({
  type: z.enum(["check_in", "check_out"]),
  source: z.enum(["office", "site"]).default("office"),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number(),
  address: z.string().optional().nullable(),
  authMethod: z.enum(["password_session", "webauthn"]),
  clientEventId: z.string().min(10),
  capturedAtClient: z.number(),
  deviceId: z.string().optional().nullable(),
  siteVisitId: z.string().optional().nullable(),
  geofenceIdOverride: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!user.permissions.includes(PERMISSIONS.ATTENDANCE_SELF) && !user.permissions.includes(PERMISSIONS.SITE_VISIT)) {
    return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403 });
  }
  if (!user.employeeId) {
    return NextResponse.json({ error: "No employee profile is linked to your account." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const event = await recordAttendanceEvent({ actor: user, employeeId: user.employeeId, ...parsed.data });
    return NextResponse.json({ ok: true, event });
  } catch (err) {
    if (err instanceof AttendanceError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error(err);
    return NextResponse.json({ error: "Something went wrong recording attendance. Please try again." }, { status: 500 });
  }
}
