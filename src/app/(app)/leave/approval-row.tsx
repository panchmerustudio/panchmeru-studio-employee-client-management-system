"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideLeave } from "./actions";
import { formatDate } from "@/lib/format";

type Request = {
  id: string;
  startDate: Date;
  endDate: Date;
  reason: string;
  isHalfDay: boolean;
  typeName: string;
  employeeName: string;
  workingDays: number;
  previewPaidDays: number;
  previewUnpaidDays: number;
  previewDeduction: number;
};

export function ApprovalRow({ request }: { request: Request }) {
  const [comment, setComment] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function decide(decision: "approved" | "rejected") {
    startTransition(async () => {
      await decideLeave(request.id, decision, comment);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold">{request.employeeName}</span>
        <span className="text-xs text-muted">
          {formatDate(request.startDate)} – {formatDate(request.endDate)} {request.isHalfDay ? "(half day)" : ""}
        </span>
      </div>
      <p className="mb-1 text-sm text-muted">{request.typeName} · {request.reason} · {request.workingDays} day{request.workingDays === 1 ? "" : "s"}</p>
      {request.previewUnpaidDays > 0 && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
          Approving this uses {request.previewPaidDays} remaining paid day{request.previewPaidDays === 1 ? "" : "s"} — the other {request.previewUnpaidDays} day
          {request.previewUnpaidDays === 1 ? "" : "s"} will be unpaid{request.previewDeduction > 0 ? ` (₹${request.previewDeduction.toLocaleString("en-IN")} deduction)` : ""}.
        </p>
      )}
      <div className="flex gap-2">
        <input className="input flex-1" placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button onClick={() => decide("approved")} disabled={pending} className="btn btn-primary shrink-0">Approve</button>
        <button onClick={() => decide("rejected")} disabled={pending} className="btn btn-danger shrink-0">Reject</button>
      </div>
    </div>
  );
}
