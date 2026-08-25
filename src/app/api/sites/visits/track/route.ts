import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { trackSiteVisitPoint } from "@/lib/site-visit-service";

const schema = z.object({ siteVisitId: z.string(), latitude: z.number(), longitude: z.number(), accuracy: z.number() });

/** GPS trail while a site visit is active (section 26/57) — stops mattering the instant checkout happens. */
export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const point = await trackSiteVisitPoint(parsed.data);
  return NextResponse.json({ ok: true, tracked: !!point });
}
