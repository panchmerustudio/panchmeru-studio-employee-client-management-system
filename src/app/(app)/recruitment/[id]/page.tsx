import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { jobApplications, users } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { formatDateTime } from "@/lib/format";
import { StatusForm } from "./status-form";

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.RECRUITMENT_MANAGE).catch(() => null);
  if (!user) redirect("/home");

  const application = await db.query.jobApplications.findFirst({ where: eq(jobApplications.id, id) });
  if (!application) notFound();

  const reviewer = application.reviewedBy ? await db.query.users.findFirst({ where: eq(users.id, application.reviewedBy) }) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={application.fullName}
        subtitle={`Applied for ${application.positionAppliedFor} · ${formatDateTime(application.createdAt)}`}
        action={
          <div className="flex items-center gap-2">
            <Badge status={application.status} />
            <Link href="/recruitment" className="btn btn-secondary">
              <Icon name="arrow-left" className="h-4 w-4" /> Back
            </Link>
          </div>
        }
      />

      <div className="grid gap-5 md:grid-cols-3">
        <div className="space-y-5 md:col-span-2">
          <SectionCard title="Contact">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted">Email</dt>
                <dd className="font-medium">
                  <a href={`mailto:${application.email}`} className="text-accent hover:underline">
                    {application.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Phone</dt>
                <dd className="font-medium">
                  <a href={`tel:${application.phone}`} className="text-accent hover:underline">
                    {application.phone}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Experience</dt>
                <dd className="font-medium">{application.experienceYears != null ? `${application.experienceYears} yrs` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Portfolio link</dt>
                <dd className="font-medium">
                  {application.portfolioUrl ? (
                    <a href={application.portfolioUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {application.portfolioUrl}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
          </SectionCard>

          {application.coverNote && (
            <SectionCard title="Cover note">
              <p className="whitespace-pre-wrap text-sm text-foreground">{application.coverNote}</p>
            </SectionCard>
          )}

          <SectionCard title="Attachments">
            {!application.resumeFileId && !application.portfolioFileId ? (
              <p className="text-sm text-muted">No files attached.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {application.resumeFileId && (
                  <a href={`/api/files/${application.resumeFileId}`} target="_blank" rel="noreferrer" className="badge bg-slate-100 text-slate-700">
                    <Icon name="file" className="h-3 w-3" /> Resume / CV
                  </a>
                )}
                {application.portfolioFileId && (
                  <a href={`/api/files/${application.portfolioFileId}`} target="_blank" rel="noreferrer" className="badge bg-slate-100 text-slate-700">
                    <Icon name="file" className="h-3 w-3" /> Portfolio file
                  </a>
                )}
              </div>
            )}
          </SectionCard>

          {application.reviewNote && (
            <SectionCard title="Review note">
              <p className="text-sm text-foreground">{application.reviewNote}</p>
              {reviewer && <p className="mt-1 text-xs text-muted">— {reviewer.name}</p>}
            </SectionCard>
          )}
        </div>

        <div>
          <StatusForm applicationId={application.id} currentStatus={application.status} currentNote={application.reviewNote} />
        </div>
      </div>
    </div>
  );
}
