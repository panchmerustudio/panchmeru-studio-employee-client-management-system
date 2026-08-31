import { redirect } from "next/navigation";
import { getCurrentClient } from "@/lib/client-auth";
import { getClientDrawings, getClientApprovedDrawings, getClientRevisionRequests, getClientActivity } from "@/lib/client-portal";
import { PageHeader, StatCard } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo } from "@/lib/format";
import { LogoutButton } from "./logout-button";
import { ClientNav } from "./client-nav";

export default async function ClientPortalHome() {
  const client = await getCurrentClient();
  if (!client) redirect("/client/login");

  const [drawings, approved, revisions, activity] = await Promise.all([
    getClientDrawings(client.clientId),
    getClientApprovedDrawings(client.clientId),
    getClientRevisionRequests(client.clientId),
    getClientActivity(client.clientId, 8),
  ]);

  const actionRequired = drawings.filter((d) => d.responseStatus === "awaiting_response").length;
  const openRevisions = revisions.filter((r) => !["approved", "rejected"].includes(r.status)).length;

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <PageHeader title={`Welcome, ${client.contactName ?? client.clientName}`} subtitle={client.clientName} action={<LogoutButton />} />
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Drawings open in-app only, watermarked to you. Once a drawing is approved, you can download it from the Approved tab.
      </p>

      {actionRequired > 0 && (
        <div className="card flex items-center justify-between gap-3 border-amber-200 bg-amber-50 p-4">
          <div>
            <div className="text-sm font-semibold text-amber-900">Action required</div>
            <div className="text-xs text-amber-800">
              {actionRequired} drawing{actionRequired === 1 ? "" : "s"} awaiting your review
            </div>
          </div>
          <a href="/client/drawings" className="btn btn-primary shrink-0">
            Review
          </a>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Drawings shared" value={drawings.length} icon="file" href="/client/drawings" />
        <StatCard label="Approved drawings" value={approved.length} icon="check-circle" href="/client/approved" tone="success" />
        <StatCard label="Open revisions" value={openRevisions} icon="edit" href="/client/revisions" tone={openRevisions > 0 ? "warning" : "default"} />
        <StatCard label="Action required" value={actionRequired} icon="alert" href="/client/drawings" tone={actionRequired > 0 ? "danger" : "default"} />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold">Recent activity</h3>
        {activity.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet — updates on your drawings will show up here.</p>
        ) : (
          <div className="space-y-3">
            {activity.map((a) => (
              <div key={a.id} className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <Icon name="bell" className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{a.description}</p>
                  <p className="text-xs text-muted">{timeAgo(a.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ClientNav active="/client" />
    </div>
  );
}
