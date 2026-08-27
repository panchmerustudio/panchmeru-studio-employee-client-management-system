"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmSurvey, rejectSurvey } from "../../sites/[id]/survey/actions";

export function ReviewForm({ surveyId }: { surveyId: string }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        await confirmSurvey(surveyId, note);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't confirm.");
      }
    });
  }

  function reject() {
    if (!note.trim()) {
      setError("Explain why this survey needs to be re-measured.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await rejectSurvey(surveyId, note);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't reject.");
      }
    });
  }

  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">Review this survey</h3>
      <label className="mb-1.5 block text-sm font-medium">Note</label>
      <textarea className="input mb-3" rows={2} placeholder="Optional for confirming, required if sending back" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-secondary" disabled={pending} onClick={reject}>
          Send back
        </button>
        <button className="btn btn-primary" disabled={pending} onClick={confirm}>
          {pending ? "Saving…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}
