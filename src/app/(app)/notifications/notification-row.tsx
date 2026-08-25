"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { timeAgo } from "@/lib/format";
import { notificationHref } from "@/lib/notification-link";
import { markRead } from "./actions";
import { decideLeave } from "../leave/actions";

type Notification = {
  id: string;
  title: string;
  message: string;
  createdAt: Date | string;
  readAt: Date | string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
};

/**
 * Was previously a server-rendered <Link onClick={markRead.bind(...)}>: calling a server action
 * from onClick alongside Link's own navigation raced against the revalidation that action
 * triggers, and the refresh would win — leaving people stuck on /notifications no matter how many
 * times they clicked. This client component instead awaits the mark-read call and then navigates
 * itself, so there's no race, and it can also carry the leave approve/reject controls below.
 */
export function NotificationRow({ notification: n, canDecideLeave }: { notification: Notification; canDecideLeave: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [comment, setComment] = useState("");
  const [decided, setDecided] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const href = notificationHref(n.relatedEntityType, n.relatedEntityId);

  function open() {
    startTransition(async () => {
      await markRead(n.id);
      if (href) router.push(href);
      else router.refresh();
    });
  }

  function decide(decision: "approved" | "rejected") {
    if (!n.relatedEntityId) return;
    setError(null);
    startTransition(async () => {
      try {
        await decideLeave(n.relatedEntityId!, decision, comment);
        await markRead(n.id);
        setDecided(decision);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save your decision.");
      }
    });
  }

  return (
    <div
      onClick={open}
      role={href ? "button" : undefined}
      tabIndex={href ? 0 : undefined}
      className={`flex items-start gap-3 px-4 py-3.5 ${href ? "cursor-pointer hover:bg-background" : ""} ${!n.readAt ? "bg-amber-50/50" : ""} ${pending ? "opacity-70" : ""}`}
    >
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${!n.readAt ? "bg-accent text-white" : "bg-slate-100 text-slate-400"}`}>
        <Icon name="bell" className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{n.title}</div>
        <div className="text-xs text-muted">{n.message}</div>
        <div className="mt-0.5 text-[11px] text-muted">{timeAgo(n.createdAt)}</div>

        {canDecideLeave && !decided && (
          <div className="mt-2 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <input
              className="input min-w-[8rem] flex-1"
              placeholder="Reason / comment (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={pending}
            />
            <button onClick={() => decide("approved")} disabled={pending} className="btn btn-primary shrink-0">
              Approve
            </button>
            <button onClick={() => decide("rejected")} disabled={pending} className="btn btn-danger shrink-0">
              Reject
            </button>
          </div>
        )}
        {decided && (
          <p className={`mt-1 text-xs font-medium ${decided === "approved" ? "text-emerald-700" : "text-red-700"}`}>
            {decided === "approved" ? "Approved." : "Rejected."}
          </p>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
