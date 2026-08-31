import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, EmptyState } from "@/components/ui";
import { getClientPaymentOverview } from "@/lib/client-payments";
import { formatDate, statusLabel } from "@/lib/format";
import { PaymentSettingsForm } from "./payment-settings-form";
import { MilestoneManager } from "./milestone-manager";
import { RecordPaymentForm } from "./record-payment-form";

export default async function ClientPaymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERMISSIONS.CLIENT_MANAGE)) redirect("/documents");

  const client = await db.query.clients.findFirst({ where: eq(clients.id, id) });
  if (!client) notFound();

  const projectSummaries = await getClientPaymentOverview(id, true);

  return (
    <div className="space-y-5">
      <PageHeader title={`${client.name} — Payments`} subtitle="Total fee, milestones, and payments received. Not full accounting — no invoices or tax." />

      {projectSummaries.length === 0 ? (
        <EmptyState icon="chart" title="No linked project yet" subtitle="Link a project to this client from their profile page before setting up payments." />
      ) : (
        projectSummaries.map((s) => (
          <SectionCard key={s.projectId} title={s.projectName} action={<span className="text-xs text-muted">{s.enabled ? "Tracking on" : "Tracking off"}</span>}>
            <div className="space-y-4">
              <PaymentSettingsForm clientId={id} projectId={s.projectId} enabled={s.enabled} totalFeeAmount={s.totalFeeAmount} />

              {s.totalFeeAmount != null && (
                <div className="grid grid-cols-3 gap-2 rounded-lg bg-background p-3 text-center text-sm">
                  <div>
                    <div className="font-semibold text-foreground">₹{s.totalFeeAmount.toLocaleString("en-IN")}</div>
                    <div className="text-xs text-muted">Total fee</div>
                  </div>
                  <div>
                    <div className="font-semibold text-emerald-700">₹{s.totalPaid.toLocaleString("en-IN")}</div>
                    <div className="text-xs text-muted">Paid</div>
                  </div>
                  <div>
                    <div className="font-semibold text-amber-700">₹{s.totalPending.toLocaleString("en-IN")}</div>
                    <div className="text-xs text-muted">Pending</div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Milestones</h3>
                <MilestoneManager clientId={id} projectId={s.projectId} milestones={s.milestones} />
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Record a payment</h3>
                <RecordPaymentForm clientId={id} projectId={s.projectId} milestones={s.milestones.map((m) => ({ id: m.id, name: m.name }))} />
              </div>

              {s.records.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Payment history</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-xs text-muted">
                          <th className="pb-1.5 pr-3">Date</th>
                          <th className="pb-1.5 pr-3">Amount</th>
                          <th className="pb-1.5 pr-3">Mode</th>
                          <th className="pb-1.5 pr-3">Milestone</th>
                          <th className="pb-1.5">Reference</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {s.records.map((r) => (
                          <tr key={r.id}>
                            <td className="py-1.5 pr-3">{formatDate(r.paidDate)}</td>
                            <td className="py-1.5 pr-3 font-medium">₹{r.amount.toLocaleString("en-IN")}</td>
                            <td className="py-1.5 pr-3">{statusLabel(r.mode)}</td>
                            <td className="py-1.5 pr-3">{r.milestoneName ?? "—"}</td>
                            <td className="py-1.5">{r.reference ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        ))
      )}
    </div>
  );
}
