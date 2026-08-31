import { redirect } from "next/navigation";
import { getCurrentClient } from "@/lib/client-auth";
import { getClientPaymentOverview } from "@/lib/client-payments";
import { PageHeader, SectionCard, Badge, EmptyState } from "@/components/ui";
import { formatDate, statusLabel } from "@/lib/format";
import { LogoutButton } from "../logout-button";
import { ClientNav } from "../client-nav";

export default async function ClientPaymentsPage() {
  const client = await getCurrentClient();
  if (!client) redirect("/client/login");

  const summaries = await getClientPaymentOverview(client.clientId);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <PageHeader title="Payments" subtitle={client.clientName} action={<LogoutButton />} />

      {summaries.length === 0 ? (
        <EmptyState icon="chart" title="Nothing to show yet" subtitle="Payment tracking hasn't been turned on for your project yet — ask the studio if you have questions about your fee." />
      ) : (
        summaries.map((s) => (
          <SectionCard key={s.projectId} title={s.projectName}>
            <div className="space-y-4">
              {s.totalFeeAmount != null && (
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-background p-3 text-center text-sm">
                  <div>
                    <div className="text-lg font-semibold text-foreground">₹{s.totalFeeAmount.toLocaleString("en-IN")}</div>
                    <div className="text-xs text-muted">Total fee</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-emerald-700">₹{s.totalPaid.toLocaleString("en-IN")}</div>
                    <div className="text-xs text-muted">Paid so far</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-amber-700">₹{s.totalPending.toLocaleString("en-IN")}</div>
                    <div className="text-xs text-muted">Pending</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {s.nextMilestone ? `₹${(s.nextMilestone.amount - s.nextMilestone.paidAmount).toLocaleString("en-IN")}` : "—"}
                    </div>
                    <div className="text-xs text-muted">{s.nextMilestone?.dueDate ? `Due ${formatDate(s.nextMilestone.dueDate)}` : "Next payment"}</div>
                  </div>
                </div>
              )}

              {s.nextMilestone && (s.nextMilestone.status === "overdue" || s.nextMilestone.status === "due_today") && (
                <div className={`rounded-lg px-3 py-2 text-sm ${s.nextMilestone.status === "overdue" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                  {s.nextMilestone.status === "overdue" ? "Payment overdue: " : "Payment due today: "}
                  {s.nextMilestone.name} — ₹{(s.nextMilestone.amount - s.nextMilestone.paidAmount).toLocaleString("en-IN")}
                </div>
              )}

              {s.milestones.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Milestones</h3>
                  <ul className="divide-y divide-border">
                    {s.milestones.map((m) => (
                      <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                        <div>
                          <div className="font-medium">{m.name}</div>
                          <div className="text-xs text-muted">
                            ₹{m.amount.toLocaleString("en-IN")} {m.dueDate ? `· Due ${formatDate(m.dueDate)}` : ""}
                          </div>
                        </div>
                        <Badge status={m.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {s.records.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Payment history</h3>
                  <ul className="divide-y divide-border">
                    {s.records.map((r) => (
                      <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                        <div>
                          <div className="font-medium">₹{r.amount.toLocaleString("en-IN")}</div>
                          <div className="text-xs text-muted">
                            {formatDate(r.paidDate)} · {statusLabel(r.mode)} {r.milestoneName ? `· ${r.milestoneName}` : ""}
                          </div>
                        </div>
                        {r.receiptFileId && (
                          <a href={`/api/files/${r.receiptFileId}`} target="_blank" rel="noreferrer" className="text-xs text-brand-ink underline">
                            Receipt
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </SectionCard>
        ))
      )}

      <ClientNav active="/client/payments" />
    </div>
  );
}
