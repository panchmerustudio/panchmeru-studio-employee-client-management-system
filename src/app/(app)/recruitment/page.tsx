import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { jobApplications } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";

const STATUSES = ["new", "reviewing", "shortlisted", "rejected", "hired"];

export default async function RecruitmentPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requirePermission(PERMISSIONS.RECRUITMENT_MANAGE).catch(() => null);
  if (!user) redirect("/home");
  const { status } = await searchParams;

  const rows = await db.select().from(jobApplications).orderBy(desc(jobApplications.createdAt));
  const filtered = status ? rows.filter((r) => r.status === status) : rows;

  const hdrs = await headers();
  const host = hdrs.get("host");
  const applyUrl = host ? `${host.includes("localhost") ? "http" : "https"}://${host}/apply` : "/apply";

  return (
    <div>
      <PageHeader
        title="Recruitment"
        subtitle={`${filtered.length} application${filtered.length === 1 ? "" : "s"} · submitted through the public careers page`}
      />

      <div className="card mb-4 flex flex-wrap items-center justify-between gap-2 p-3">
        <p className="text-sm text-muted">
          Share this link for people to apply — no account or login needed: <span className="font-mono text-foreground">{applyUrl}</span>
        </p>
        <a href="/apply" target="_blank" rel="noreferrer" className="btn btn-secondary shrink-0">
          Open
        </a>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <Link href="/recruitment" className={`badge ${!status ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/recruitment?status=${s}`} className={`badge whitespace-nowrap ${status === s ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}>
            {s}
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="users" title="No applications here" subtitle="Nothing matches this filter yet." />
      ) : (
        <div className="card divide-y divide-border">
          {filtered.map((a) => (
            <Link key={a.id} href={`/recruitment/${a.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-background">
              <div>
                <div className="text-sm font-medium text-foreground">{a.fullName}</div>
                <div className="text-xs text-muted">
                  {a.positionAppliedFor} · {a.email} · applied {formatDate(a.createdAt)}
                </div>
              </div>
              <Badge status={a.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
