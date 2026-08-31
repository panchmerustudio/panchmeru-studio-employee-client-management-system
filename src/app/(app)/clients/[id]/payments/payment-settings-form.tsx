"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPaymentSettings } from "./actions";

export function PaymentSettingsForm({
  clientId,
  projectId,
  enabled,
  totalFeeAmount,
}: {
  clientId: string;
  projectId: string;
  enabled: boolean;
  totalFeeAmount: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [fee, setFee] = useState(totalFeeAmount != null ? String(totalFeeAmount) : "");
  const router = useRouter();

  function toggle() {
    startTransition(async () => {
      await setPaymentSettings(clientId, projectId, !enabled, totalFeeAmount);
      router.refresh();
    });
  }

  function saveFee() {
    const amount = fee ? Number(fee) : null;
    startTransition(async () => {
      await setPaymentSettings(clientId, projectId, enabled, amount);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <button onClick={toggle} disabled={pending} className={`btn text-xs ${enabled ? "btn-secondary" : "btn-accent"}`}>
        {enabled ? "Turn off for this project" : "Turn on for this project"}
      </button>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Total project fee (₹)</label>
        <div className="flex gap-1.5">
          <input value={fee} onChange={(e) => setFee(e.target.value)} type="number" min="0" step="0.01" className="input w-auto text-xs" placeholder="e.g. 850000" />
          <button onClick={saveFee} disabled={pending} className="btn btn-secondary text-xs">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
