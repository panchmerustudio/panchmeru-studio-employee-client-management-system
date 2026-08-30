import Link from "next/link";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { AddClientForm } from "./add-client-form";

export default async function ClientsPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERMISSIONS.CLIENT_MANAGE)) redirect("/documents");

  const rows = await db.select().from(clients).orderBy(desc(clients.createdAt));

  return (
    <div className="space-y-5">
      <PageHeader title="Clients" subtitle={`${rows.length} client${rows.length === 1 ? "" : "s"} · view-only portal logins`} />

      <AddClientForm />

      {rows.length === 0 ? (
        <EmptyState icon="users" title="No clients yet" subtitle="Add a client above to give them a view-only portal login for shared drawings." />
      ) : (
        <div className="card divide-y divide-border">
          {rows.map((c) => (
            <Link key={c.id} href={`/clients/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-background">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Icon name="users" className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{c.name}</div>
                  <div className="text-xs text-muted">{c.companyName ?? c.email ?? "—"}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
