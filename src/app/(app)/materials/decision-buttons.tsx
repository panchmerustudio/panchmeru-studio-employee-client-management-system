"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideMaterialRequest } from "./actions";

export function DecisionButtons({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function decide(next: "approved" | "rejected" | "ordered" | "received") {
    startTransition(async () => {
      await decideMaterialRequest(id, next);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {status === "pending" && (
        <>
          <button disabled={pending} onClick={() => decide("approved")} className="btn btn-primary">Approve</button>
          <button disabled={pending} onClick={() => decide("rejected")} className="btn btn-danger">Reject</button>
        </>
      )}
      {status === "approved" && (
        <button disabled={pending} onClick={() => decide("ordered")} className="btn btn-secondary">Mark ordered</button>
      )}
      {status === "ordered" && (
        <button disabled={pending} onClick={() => decide("received")} className="btn btn-secondary">Mark received</button>
      )}
    </div>
  );
}
