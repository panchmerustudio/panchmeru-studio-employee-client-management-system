import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { materialRequests, materialRequestItems, sites, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { MaterialRequestForm } from "./request-form";
import { DecisionButtons } from "./decision-buttons";

export default async function MaterialsPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const siteRows = await db.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.status, "active"));

  const requests = await db
    .select({
      id: materialRequests.id,
      status: materialRequests.status,
      requiredDate: materialRequests.requiredDate,
      reason: materialRequests.reason,
      siteName: sites.name,
      requestedByName: users.name,
      createdAt: materialRequests.createdAt,
    })
    .from(materialRequests)
    .innerJoin(sites, eq(sites.id, materialRequests.siteId))
    .innerJoin(users, eq(users.id, materialRequests.requestedBy))
    .orderBy(desc(materialRequests.createdAt));

  const items = await Promise.all(requests.map((r) => db.select().from(materialRequestItems).where(eq(materialRequestItems.materialRequestId, r.id))));

  const canApprove = user.permissions.includes(PERMISSIONS.MATERIAL_APPROVE);

  return (
    <div className="space-y-6">
      <PageHeader title="Material Requests" subtitle={`${requests.length} request${requests.length === 1 ? "" : "s"}`} />

      <div className="grid gap-5 md:grid-cols-3">
        <SectionCard title="New request">
          <MaterialRequestForm sites={siteRows} />
        </SectionCard>

        <div className="md:col-span-2">
          {requests.length === 0 ? (
            <EmptyState icon="package" title="No material requests yet" />
          ) : (
            <div className="space-y-3">
              {requests.map((r, i) => (
                <div key={r.id} className="card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">{r.siteName}</div>
                      <div className="text-xs text-muted">{r.requestedByName} · {formatDate(r.createdAt)}</div>
                    </div>
                    <Badge status={r.status} />
                  </div>
                  <ul className="mb-2 text-sm">
                    {items[i].map((it) => (
                      <li key={it.id}>{it.materialName} — {it.quantity} {it.unit}</li>
                    ))}
                  </ul>
                  {r.reason && <p className="mb-2 text-xs text-muted">{r.reason}</p>}
                  {canApprove && <DecisionButtons id={r.id} status={r.status} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
