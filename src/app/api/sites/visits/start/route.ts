import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { startSiteVisit, SiteVisitError } from "@/lib/site-visit-service";

const schema = z.object({
  siteId: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number(),
  address: z.string().optional().nullable(),
  authMethod: z.enum(["password_session", "webauthn"]),
  clientEventId: z.string().min(10),
});

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!user.employeeId) return NextResponse.json({ error: "No employee profile linked to your account." }, { status: 400 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });

  try {
    const visit = await startSiteVisit({ actor: user, employeeId: user.employeeId, ...parsed.data });
    return NextResponse.json({ ok: true, visit });
  } catch (err) {
    if (err instanceof SiteVisitError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "Couldn't start the site visit. Please try again." }, { status: 500 });
  }
}
