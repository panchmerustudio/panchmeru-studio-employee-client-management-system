import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { files as filesTable, users } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/ui";
import { Icon } from "@/components/icon";
import { formatBytes, formatDate } from "@/lib/format";
import { checkStorageThresholdAndNotify } from "@/lib/storage-usage";
import { CapForm } from "./cap-form";
import { DeleteFileButton } from "./delete-button";
import { RecheckButton } from "./recheck-button";

const KIND_LABELS: Record<string, string> = {
  photo: "Photos",
  document: "Documents",
  voice: "Voice notes",
  drawing: "Drawings",
  other: "Other",
};

export default async function StoragePage() {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE).catch(() => null);
  if (!user) redirect("/home");

  // Reactive check — same call the owner dashboard makes, so opening
  // either page picks up a threshold crossing and notifies. Wrapped so a
  // hiccup here never breaks the page itself.
  const usage = await checkStorageThresholdAndNotify().catch(() => null);

  const oldFiles = await db
    .select({
      id: filesTable.id,
      originalName: filesTable.originalName,
      sizeBytes: filesTable.sizeBytes,
      kind: filesTable.kind,
      createdAt: filesTable.createdAt,
      relatedEntityType: filesTable.relatedEntityType,
      uploaderName: users.name,
    })
    .from(filesTable)
    .leftJoin(users, eq(filesTable.uploadedBy, users.id))
    .orderBy(asc(filesTable.createdAt))
    .limit(25);

  const usedPercent = usage ? Math.min(100, usage.usedPercent) : 0;
  const barTone = !usage ? "bg-slate-300" : usage.usedPercent >= 100 ? "bg-red-600" : usage.usedPercent >= 90 ? "bg-red-500" : usage.usedPercent >= 80 ? "bg-amber-500" : "bg-emerald-600";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Storage"
        subtitle="Cloudflare R2 usage, alerts, and cleanup"
        action={
          <Link href="/settings" className="btn btn-secondary">
            <Icon name="arrow-left" className="h-4 w-4" /> Settings
          </Link>
        }
      />

      <SectionCard title="Usage" action={<RecheckButton />}>
        {!usage ? (
          <p className="text-sm text-muted">Couldn&apos;t load storage usage right now — try again in a moment.</p>
        ) : (
          <>
            <div className="mb-2 flex items-end justify-between">
              <div>
                <span className="text-2xl font-semibold text-foreground">{formatBytes(usage.totalBytes)}</span>
                <span className="ml-1 text-sm text-muted">of {usage.capGb} GB</span>
              </div>
              <span className={`text-sm font-medium ${usage.usedPercent >= 90 ? "text-red-600" : usage.usedPercent >= 80 ? "text-amber-600" : "text-muted"}`}>
                {Math.round(usage.usedPercent)}%
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${barTone}`} style={{ width: `${usedPercent}%` }} />
            </div>
            {usage.usedPercent >= 80 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {usage.usedPercent >= 100
                    ? "Storage is full. New uploads may start failing — delete old files below or raise the plan size."
                    : "Storage is getting close to the plan limit. Owners and managers were notified — review and delete old files below."}
                </span>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">
              {usage.fileCount} file{usage.fileCount === 1 ? "" : "s"} total. Counted from what this app has recorded — the source of truth, since
              every upload is written here first.
            </p>

            {usage.byKind.length > 0 && (
              <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {usage.byKind.map((k) => (
                  <li key={k.kind} className="rounded-lg bg-background p-2.5">
                    <div className="text-xs text-muted">{KIND_LABELS[k.kind] ?? k.kind}</div>
                    <div className="text-sm font-semibold text-foreground">{formatBytes(k.totalBytes)}</div>
                    <div className="text-[11px] text-muted">{k.count} file{k.count === 1 ? "" : "s"}</div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard title="Plan size">
        <p className="mb-3 text-sm text-muted">
          Cloudflare R2&apos;s free tier is 10 GB. Change this if you upgrade R2&apos;s plan, so the usage bar and alerts above stay accurate.
        </p>
        <CapForm currentCapGb={usage?.capGb ?? 10} />
      </SectionCard>

      <SectionCard title="Cleanup — oldest files" action={<span className="text-xs text-muted">Oldest {oldFiles.length} shown</span>}>
        {oldFiles.length === 0 ? (
          <p className="text-sm text-muted">No files yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {oldFiles.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{f.originalName}</div>
                  <div className="text-xs text-muted">
                    {KIND_LABELS[f.kind] ?? f.kind} · {formatBytes(f.sizeBytes)} · uploaded {formatDate(f.createdAt)}
                    {f.uploaderName ? ` by ${f.uploaderName}` : ""}
                  </div>
                </div>
                <DeleteFileButton fileId={f.id} fileName={f.originalName} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
