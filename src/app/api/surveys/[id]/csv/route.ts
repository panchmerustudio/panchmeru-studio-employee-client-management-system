import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db/client";
import { plotSurveys, surveyPoints, sites } from "@/db/schema";
import { PERMISSIONS } from "@/lib/rbac";

/**
 * CSV coordinate export (section 33) — the full raw GPS log, sequence by
 * sequence, exactly as captured (flagged points included, clearly marked).
 * GeoJSON/PDF export and DXF/DWG professional-import are future scope; CSV
 * is the one format asked for now, and the simplest to open in Excel/QGIS.
 */
function csvEscape(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, id) });
  if (!survey) return NextResponse.json({ error: "Survey not found." }, { status: 404 });

  const canViewAll = user.permissions.includes(PERMISSIONS.SURVEY_APPROVE) || user.permissions.includes(PERMISSIONS.SITE_MANAGE) || user.permissions.includes(PERMISSIONS.SITE_VIEW_ALL);
  if (!canViewAll && survey.capturedBy !== user.id) return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403 });

  const site = await db.query.sites.findFirst({ where: eq(sites.id, survey.siteId) });
  const points = await db.query.surveyPoints.findMany({ where: eq(surveyPoints.surveyId, id), orderBy: surveyPoints.sequence });

  const header = ["sequence", "latitude", "longitude", "accuracy_m", "captured_at", "flagged", "flag_reason"];
  const rows = points.map((p) =>
    [p.sequence + 1, p.latitude, p.longitude, p.accuracy ?? "", new Date(p.capturedAt).toISOString(), p.isOutlier ? "yes" : "no", p.outlierReason ?? ""].map(csvEscape).join(",")
  );
  const meta = [
    `# Site: ${site?.name ?? survey.siteId}`,
    `# Survey #${survey.surveyNumber} — status: ${survey.status}`,
    `# Approximate GPS boundary walk — NOT a legal survey.`,
    survey.rawAreaSqFt != null ? `# Raw area: ${survey.rawAreaSqFt} sq ft, perimeter: ${survey.rawPerimeterFt} ft` : "",
    survey.isAdjusted && survey.adjustedAreaSqFt != null ? `# Adjusted area: ${survey.adjustedAreaSqFt} sq ft, perimeter: ${survey.adjustedPerimeterFt} ft (reason: ${survey.adjustmentReason ?? ""})` : "",
  ].filter(Boolean);

  const csv = [...meta, header.join(","), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="survey-${survey.surveyNumber}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
