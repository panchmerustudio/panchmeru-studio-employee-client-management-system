import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, users } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export default async function AuditPage() {
  const user = await requirePermission(PERMISSIONS.AUDIT_VIEW).catch(() => null);
  if (!user) redirect("/home");

  const rows = await db
    .select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, createdAt: auditLogs.createdAt, actorName: users.name })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(200);

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Who did what, and when — every important action is recorded and kept." />
      {rows.length === 0 ? (
        <EmptyState icon="shield" title="No activity recorded yet" />
      ) : (
        <div className="card divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <span className="font-medium text-foreground">{r.actorName ?? "System"}</span>
                <span className="text-muted"> · {r.action.replace(/_/g, " ").replace(".", " → ")} · {r.entityType} #{r.entityId.slice(0, 8)}</span>
              </div>
              <span className="shrink-0 text-xs text-muted">{formatDateTime(r.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
