import { redirect } from "next/navigation";
import { getCurrentClient } from "@/lib/client-auth";
import { getClientRevisionRequests } from "@/lib/client-portal";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo } from "@/lib/format";
import { LogoutButton } from "../logout-button";
import { ClientNav } from "../client-nav";

export default async function ClientRevisionsPage() {
  const client = await getCurrentClient();
  if (!client) redirect("/client/login");

  const requests = await getClientRevisionRequests(client.clientId);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <PageHeader title="Revisions" subtitle="Changes you've asked for, and where they stand" action={<LogoutButton />} />

      {requests.length === 0 ? (
        <EmptyState icon="edit" title="No revision requests yet" subtitle="When you request a change on a drawing, it'll show up here with its status." />
      ) : (
        <div className="card divide-y divide-border">
          {requests.map((r) => (
            <div key={r.id} className="flex items-start gap-3 px-4 py-3.5">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <Icon name="edit" className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-foreground">
                    #{String(r.sequenceNumber).padStart(3, "0")} · {r.documentName} · V{r.versionNumber}
                  </div>
                  <Badge status={r.status} />
                </div>
                <p className="mt-1 text-sm text-muted">{r.requestText}</p>
                <p className="mt-1 text-xs text-muted">Requested {timeAgo(r.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <ClientNav active="/client/revisions" />
    </div>
  );
}
