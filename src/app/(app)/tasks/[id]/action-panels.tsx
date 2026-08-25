"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitTask, reviewTask, rescheduleTask, cancelTask } from "../actions";
import { Icon } from "@/components/icon";

export function SubmitWorkPanel({ taskId }: { taskId: string }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function submit() {
    const fd = new FormData();
    fd.set("note", note);
    const files = fileInput.current?.files;
    if (files) Array.from(files).forEach((f) => fd.append("files", f));
    startTransition(async () => {
      try {
        await submitTask(taskId, fd);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't submit.");
      }
    });
  }

  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">Submit your work</h3>
      <textarea className="input mb-2" rows={3} placeholder="What did you complete?" value={note} onChange={(e) => setNote(e.target.value)} />
      <input ref={fileInput} type="file" multiple className="mb-3 w-full text-xs" />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button onClick={submit} disabled={pending} className="btn btn-accent w-full">
        {pending ? "Submitting…" : "Submit for review"}
      </button>
    </div>
  );
}

export function ReviewPanel({ taskId }: { taskId: string }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function decide(decision: "approved" | "modification_requested") {
    startTransition(async () => {
      try {
        await reviewTask(taskId, decision, note);
        setNote("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't submit review.");
      }
    });
  }

  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">Review submission</h3>
      <textarea className="input mb-3" rows={3} placeholder="Feedback (optional for approval, recommended for modification)…" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => decide("approved")} disabled={pending} className="btn btn-primary flex-1">
          <Icon name="check-circle" className="h-4 w-4" /> Approve
        </button>
        <button onClick={() => decide("modification_requested")} disabled={pending} className="btn btn-danger flex-1">
          Request changes
        </button>
      </div>
    </div>
  );
}

export function ManagerToolsPanel({ taskId }: { taskId: string }) {
  const [pending, startTransition] = useTransition();
  const [newDate, setNewDate] = useState("");
  const router = useRouter();

  function reschedule() {
    if (!newDate) return;
    startTransition(async () => {
      await rescheduleTask(taskId, newDate);
      router.push("/tasks");
    });
  }
  function cancel() {
    startTransition(async () => {
      await cancelTask(taskId, "Cancelled by manager");
      router.refresh();
    });
  }

  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">Manager tools</h3>
      <div className="mb-2 flex gap-2">
        <input type="date" className="input" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        <button onClick={reschedule} disabled={pending || !newDate} className="btn btn-secondary shrink-0">Carry forward</button>
      </div>
      <button onClick={cancel} disabled={pending} className="btn btn-danger w-full">Cancel task</button>
    </div>
  );
}
