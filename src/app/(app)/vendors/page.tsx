import Link from "next/link";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { vendors } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { AddVendorForm } from "./add-vendor-form";

export default async function VendorsPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERMISSIONS.VENDOR_MANAGE)) redirect("/documents");

  const rows = await db.select().from(vendors).orderBy(desc(vendors.createdAt));

  return (
    <div className="space-y-5">
      <PageHeader title="Vendors" subtitle={`${rows.length} vendor${rows.length === 1 ? "" : "s"} · trade-scoped portal logins`} />

      <AddVendorForm />

      {rows.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title="No vendors yet"
          subtitle="Add a vendor above to give them a portal login scoped to their trade category and assigned project(s)."
        />
      ) : (
        <div className="card divide-y divide-border">
          {rows.map((v) => (
            <Link key={v.id} href={`/vendors/${v.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-background">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Icon name="briefcase" className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{v.name}</div>
                  <div className="text-xs text-muted">{v.category ?? "—"} {v.mobile ? `· ${v.mobile}` : ""}</div>
                </div>
              </div>
              <Badge status={v.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
