import { redirect } from "next/navigation";
import { getCurrentClient } from "@/lib/client-auth";
import { getClientApprovedDrawings } from "@/lib/client-portal";
import { PageHeader, EmptyState } from "@/components/ui";
import { LogoutButton } from "../logout-button";
import { ClientNav } from "../client-nav";
import { DrawingCard } from "../drawing-card";

export default async function ClientApprovedPage() {
  const client = await getCurrentClient();
  if (!client) redirect("/client/login");

  const drawings = await getClientApprovedDrawings(client.clientId);
  const groups = new Map<string, { name: string; items: typeof drawings }>();
  for (const d of drawings) {
    const key = d.categoryKey ?? "other";
    if (!groups.has(key)) groups.set(key, { name: d.categoryName ?? "Other", items: [] });
    groups.get(key)!.items.push(d);
  }
  const sorted = Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <PageHeader title="Approved drawings" subtitle="Your final, downloadable set" action={<LogoutButton />} />

      {drawings.length === 0 ? (
        <EmptyState icon="check-circle" title="No approved drawings yet" subtitle="Drawings you approve will collect here, ready to download." />
      ) : (
        <div className="space-y-5">
          {sorted.map((g) => (
            <div key={g.name}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.name}</h3>
              <div className="space-y-2">
                {g.items.map((d) => (
                  <DrawingCard key={d.shareId} drawing={d} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ClientNav active="/client/approved" />
    </div>
  );
}
