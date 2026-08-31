import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { featureFlags, documentCategories } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/ui";
import { Icon } from "@/components/icon";
import { formatBytes } from "@/lib/format";
import { getStorageUsage } from "@/lib/storage-usage";
import { FlagToggle } from "./flag-toggle";
import { SyncPermissionsButton } from "./sync-permissions-button";
import { DocumentCategories } from "./document-categories";

// These three used to be listed under "Future modules" as off-by-default.
// They're now fully live (drawing library, categories, approval/revision
// workflow) regardless of what their flag row says — the flag system was
// never actually wired to gate them (see feature-flags.ts), so rather than
// leave a misleading "OFF" toggle next to a feature that's fully working,
// they're excluded from that list and get their own section below instead.
const NOW_ACTIVE_FLAG_KEYS = new Set(["CLIENT_MANAGEMENT", "CLIENT_PORTAL", "CLIENT_DRAWING_APPROVAL", "VENDOR_MANAGEMENT"]);

export default async function SettingsPage() {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE).catch(() => null);
  if (!user) redirect("/home");

  const flags = await db.select().from(featureFlags);
  const futureFlags = flags.filter((f) => !NOW_ACTIVE_FLAG_KEYS.has(f.key));
  const categories = await db.select({ key: documentCategories.key, name: documentCategories.name }).from(documentCategories).orderBy(documentCategories.name);
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

      <SectionCard title="Client Portal" action={<span className="text-xs text-emerald-700">Active</span>}>
        <p className="mb-4 text-sm text-muted">
          Clients sign in at <code>/client</code> to browse their shared drawings by category, search/filter, preview in-app, approve
          or request a revision, and download once a drawing is approved. Manage client logins and share drawings from{" "}
          <Link href="/clients" className="font-medium text-brand-ink underline">
            Clients
          </Link>
          . Revision requests clients send in are handled from{" "}
          <Link href="/clients/revision-requests" className="font-medium text-brand-ink underline">
            Revision Requests
          </Link>
          .
        </p>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Drawing categories</h3>
        <DocumentCategories categories={categories} />
      </SectionCard>

      <SectionCard title="Vendor Management" action={<span className="text-xs text-emerald-700">Active</span>}>
        <p className="text-sm text-muted">
          Vendors sign in at <code>/vendor</code> to view drawings for their trade, scoped to the project(s) they&apos;re assigned to and
          the drawing category(ies) they&apos;ve been granted — never client info, other vendors, payments, or internal chat. Add vendors,
          assign projects, and manage category access from{" "}
          <Link href="/vendors" className="font-medium text-brand-ink underline">
            Vendors
          </Link>
          .
        </p>
      </SectionCard>

      <SectionCard title="Future modules" action={<span className="text-xs text-muted">Off by default</span>}>
        <p className="mb-4 text-sm text-muted">
          These modules are fully modeled in the database and ready to go, but stay hidden from the app until you turn them on —
          so today&apos;s team only sees what they need.
        </p>
        <ul className="divide-y divide-border">
          {futureFlags.map((f) => (
            <li key={f.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-medium">{f.name}</div>
                <div className="text-xs text-muted">{f.description}</div>
              </div>
              <FlagToggle flagKey={f.key} enabled={f.enabled} />
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
