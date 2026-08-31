import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { featureFlags } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/ui";
import { Icon } from "@/components/icon";
import { formatBytes } from "@/lib/format";
import { getStorageUsage } from "@/lib/storage-usage";
import { FlagToggle } from "./flag-toggle";
import { SyncPermissionsButton } from "./sync-permissions-button";

export default async function SettingsPage() {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE).catch(() => null);
  if (!user) redirect("/home");

  const flags = await db.select().from(featureFlags);
  const usage = await getStorageUsage().catch(() => null);

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Studio configuration" />

      <SectionCard title="Storage">
        <Link href="/settings/storage" className="flex items-center justify-between gap-3 rounded-lg p-1 transition-colors hover:bg-background">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-brand-ink">
              <Icon name="database" className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">
                {usage ? `${formatBytes(usage.totalBytes)} of ${usage.capGb} GB used` : "Cloud storage"}
              </div>
              <div className="text-xs text-muted">Usage, alerts, and cleanup</div>
            </div>
          </div>
          {usage && usage.usedPercent >= 80 && (
            <span className={`badge ${usage.usedPercent >= 100 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
              {Math.round(usage.usedPercent)}%
            </span>
          )}
        </Link>
      </SectionCard>

      <SectionCard title="Permissions">
        <p className="mb-3 text-sm text-muted">
          Every time a new feature adds a permission (like the CAD Modeler, in-app document viewing, or client sharing did), it has to
          reach this studio&apos;s database once before roles actually get it. Click this after any update instead of visiting a setup URL by hand.
        </p>
        <SyncPermissionsButton />
      </SectionCard>

      <SectionCard title="Future modules" action={<span className="text-xs text-muted">Off by default</span>}>
        <p className="mb-4 text-sm text-muted">
          These modules are fully modeled in the database and ready to go, but stay hidden from the app until you turn them on —
          so today&apos;s team only sees what they need.
        </p>
        <ul className="divide-y divide-border">
          {flags.map((f) => (
            <li key={f.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-medium">{f.name}</div>
                <div className="text-xs text-muted">
                  {f.description}
                  {(f.key === "CLIENT_MANAGEMENT" || f.key === "CLIENT_PORTAL") && " — a basic version (add a client, share a drawing, client views it) is already live under Clients, independent of this toggle."}
                </div>
              </div>
              <FlagToggle flagKey={f.key} enabled={f.enabled} />
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
