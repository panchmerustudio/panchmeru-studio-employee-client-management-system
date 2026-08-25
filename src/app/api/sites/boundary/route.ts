import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { siteBoundaries } from "@/db/schema";
import { computeBoundaryStats } from "@/lib/geo";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

const schema = z.object({
  siteId: z.string(),
  points: z.array(z.object({ lat: z.number(), lng: z.number() })).min(3, "Walk at least 3 points to form a boundary."),
});

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!user.permissions.includes(PERMISSIONS.SITE_VISIT) && !user.permissions.includes(PERMISSIONS.SITE_MANAGE)) {
    return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });

  const stats = computeBoundaryStats(parsed.data.points);
  const [boundary] = await db
    .insert(siteBoundaries)
    .values({
      siteId: parsed.data.siteId,
      points: parsed.data.points,
      areaSqFt: stats.areaSqFt ?? undefined,
      perimeterFt: stats.perimeterFt ?? undefined,
      capturedBy: user.id,
    })
    .returning();

  await recordAudit({ actor: user, action: "site.boundary_captured", entityType: "site", entityId: parsed.data.siteId, newState: stats });
  return NextResponse.json({ ok: true, boundary });
}
