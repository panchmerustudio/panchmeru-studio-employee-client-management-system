import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { featureFlags } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/ui";
import { FlagToggle } from "./flag-toggle";

export default async function SettingsPage() {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE).catch(() => null);
  if (!user) redirect("/home");

  const flags = await db.select().from(featureFlags);

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Studio configuration" />

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
