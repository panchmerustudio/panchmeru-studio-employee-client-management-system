import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { plotSurveys, sites, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { timeAgo } from "@/lib/format";

const STATUSES = ["in_progress", "needs_review", "confirmed", "rejected", "superseded", "cancelled"];

export default async function SurveysPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  const canViewAll = user.permissions.includes(PERMISSIONS.SURVEY_APPROVE) || user.permissions.includes(PERMISSIONS.SITE_MANAGE) || user.permissions.includes(PERMISSIONS.SITE_VIEW_ALL);
  if (!canViewAll && !user.permissions.includes(PERMISSIONS.SURVEY_CREATE)) redirect("/home");

  const { status } = await searchParams;

  const rows = await db
    .select({
      id: plotSurveys.id,
      siteId: plotSurveys.siteId,
      siteName: sites.name,
      surveyNumber: plotSurveys.surveyNumber,
      status: plotSurveys.status,
      rawAreaSqFt: plotSurveys.rawAreaSqFt,
      capturedBy: plotSurveys.capturedBy,
      capturedByName: users.name,
      createdAt: plotSurveys.createdAt,
      isAdjusted: plotSurveys.isAdjusted,
    })
    .from(plotSurveys)
    .innerJoin(sites, eq(sites.id, plotSurveys.siteId))
    .innerJoin(users, eq(users.id, plotSurveys.capturedBy))
    .orderBy(desc(plotSurveys.createdAt));

  // A plain SURVEY_CREATE holder (no approve/manage/view-all) only sees their own surveys — an
  // approver/manager sees the full permanent history across the studio.
  const visible = canViewAll ? rows : rows.filter((r) => r.capturedBy === user.id);
  const finalRows = status ? visible.filter((r) => r.status === status) : visible;

  return (
    <div>
      <PageHeader title="Plot surveys" subtitle={`${finalRows.length} survey${finalRows.length === 1 ? "" : "s"} · permanent history, never overwritten`} />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <Link href="/surveys" className={`badge ${!status ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/surveys?status=${s}`} className={`badge whitespace-nowrap ${status === s ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}>
            {s.replace("_", " ")}
          </Link>
        ))}
      </div>

      {finalRows.length === 0 ? (
        <EmptyState icon="ruler" title="No surveys here" subtitle="Nothing matches this filter yet." />
      ) : (
        <div className="card divide-y divide-border">
          {finalRows.map((r) => (
            <Link key={r.id} href={`/surveys/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-background">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {r.siteName} · #{r.surveyNumber} {r.isAdjusted && <span className="text-xs text-muted">(adjusted)</span>}
                </div>
                <div className="text-xs text-muted">
                  {r.capturedByName} · {timeAgo(r.createdAt)} {r.rawAreaSqFt ? `· ${r.rawAreaSqFt.toLocaleString()} sq ft` : ""}
                </div>
              </div>
              <Badge status={r.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
