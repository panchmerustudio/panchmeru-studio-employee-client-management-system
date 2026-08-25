"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewTask, submitTask, updateTaskProgress } from "../actions";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { formatDate } from "@/lib/format";

type Card = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | Date | null;
  assignedToName: string;
  siteName: string | null;
  projectName: string | null;
  isMine: boolean;
  isOverdue: boolean;
};

const COLUMNS = [
  { key: "to_do", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "submitted", label: "Submitted" },
  { key: "modification_required", label: "Needs Changes" },
  { key: "approved", label: "Approved" },
] as const;

type MoveTarget = { key: string; label: string; mode: "direct" | "submit" | "review"; decision?: "approved" | "modification_requested" };

/** Mirrors the server-side rules in updateTaskProgress/submitTask/reviewTask — client-side is only for deciding what to show; the action itself re-checks everything. */
function validTargetsFor(card: Card, canApprove: boolean): MoveTarget[] {
  const targets: MoveTarget[] = [];
  if (card.isMine) {
    if (card.status === "to_do") targets.push({ key: "in_progress", label: "In Progress", mode: "direct" });
    if (card.status === "in_progress") targets.push({ key: "to_do", label: "To Do", mode: "direct" });
    if (card.status === "modification_required") targets.push({ key: "in_progress", label: "In Progress", mode: "direct" });
    if (["to_do", "in_progress", "modification_required"].includes(card.status)) {
      targets.push({ key: "submitted", label: "Submitted", mode: "submit" });
    }
  }
  if (canApprove && card.status === "submitted") {
    targets.push({ key: "approved", label: "Approved", mode: "review", decision: "approved" });
    targets.push({ key: "modification_required", label: "Needs Changes", mode: "review", decision: "modification_requested" });
  }
  return targets;
}

export function TaskBoard({ cards, canApprove }: { cards: Card[]; canApprove: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<{ card: Card; target: MoveTarget } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function attemptMove(card: Card, targetKey: string) {
    if (targetKey === card.status) return;
    const target = validTargetsFor(card, canApprove).find((t) => t.key === targetKey);
    if (!target) {
      flash(`Can't move "${card.title}" there.`);
      return;
    }
    if (target.mode === "direct") {
      startTransition(async () => {
        try {
          await updateTaskProgress(card.id, target.key as "to_do" | "in_progress");
          router.refresh();
        } catch (err) {
          flash(err instanceof Error ? err.message : "Couldn't move this task.");
        }
      });
    } else {
      setModal({ card, target });
    }
  }

  return (
    <div>
      {toast && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{toast}</div>}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((col) => {
          const colCards = cards.filter((c) => c.status === col.key);
          return (
            <div
              key={col.key}
              className="w-64 shrink-0 rounded-xl bg-background/60 p-2"
              onDragOver={(e) => {
                if (dragId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const card = cards.find((c) => c.id === dragId);
                setDragId(null);
                if (card) attemptMove(card, col.key);
              }}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="text-xs font-semibold text-muted">{col.label}</h3>
                <span className="text-[11px] text-muted">{colCards.length}</span>
              </div>
              <div className="space-y-2">
                {colCards.map((card) => {
                  const targets = validTargetsFor(card, canApprove);
                  const draggable = targets.length > 0;
                  return (
                    <div
                      key={card.id}
                      draggable={draggable}
                      onDragStart={() => setDragId(card.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("select")) return;
                        router.push(`/tasks/${card.id}`);
                      }}
                      className={`card cursor-pointer p-3 transition-shadow hover:shadow-sm ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${card.isOverdue ? "border-red-300" : ""}`}
                    >
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-snug text-foreground">{card.title}</span>
                        {card.priority === "urgent" && <span className="badge shrink-0 bg-red-100 text-red-700">Urgent</span>}
                      </div>
                      <div className="mb-2 text-xs text-muted">
                        {card.assignedToName}
                        {card.projectName ? ` · ${card.projectName}` : ""}
                        {card.siteName ? ` · ${card.siteName}` : ""}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] ${card.isOverdue ? "font-medium text-red-600" : "text-muted"}`}>
                          {card.dueDate ? `${card.isOverdue ? "Overdue: " : "Due "}${formatDate(card.dueDate)}` : "No due date"}
                        </span>
                        {targets.length > 0 && (
                          <select
                            aria-label={`Move ${card.title}`}
                            className="rounded border border-border bg-surface px-1 py-0.5 text-[11px]"
                            value=""
                            disabled={pending}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              if (e.target.value) attemptMove(card, e.target.value);
                              e.target.value = "";
                            }}
                          >
                            <option value="">Move to…</option>
                            {targets.map((t) => (
                              <option key={t.key} value={t.key}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}
                {colCards.length === 0 && <p className="px-1 text-xs text-muted">Empty</p>}
              </div>
            </div>
          );
        })}
      </div>

      {modal && modal.target.mode === "submit" && (
        <QuickSubmitModal card={modal.card} onClose={() => setModal(null)} onDone={() => { setModal(null); router.refresh(); }} />
      )}
      {modal && modal.target.mode === "review" && modal.target.decision && (
        <QuickReviewModal card={modal.card} decision={modal.target.decision} onClose={() => setModal(null)} onDone={() => { setModal(null); router.refresh(); }} />
      )}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} aria-label="Close">
            <Icon name="x" className="h-4 w-4 text-muted" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function QuickSubmitModal({ card, onClose, onDone }: { card: Card; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    const fd = new FormData();
    fd.set("note", note);
    startTransition(async () => {
      try {
        await submitTask(card.id, fd);
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't submit.");
      }
    });
  }

  return (
    <ModalShell title={`Submit "${card.title}"`} onClose={onClose}>
      <textarea className="input mb-2" rows={3} placeholder="What did you complete? (optional — add photos/files from the task page)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button onClick={confirm} disabled={pending} className="btn btn-accent w-full">
        {pending ? "Submitting…" : "Submit for review"}
      </button>
    </ModalShell>
  );
}

function QuickReviewModal({ card, decision, onClose, onDone }: { card: Card; decision: "approved" | "modification_requested"; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    startTransition(async () => {
      try {
        await reviewTask(card.id, decision, note);
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't submit review.");
      }
    });
  }

  return (
    <ModalShell title={decision === "approved" ? `Approve "${card.title}"` : `Request changes on "${card.title}"`} onClose={onClose}>
      <textarea
        className="input mb-2"
        rows={3}
        placeholder={decision === "approved" ? "Feedback (optional)…" : "What needs to change? (recommended)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button onClick={confirm} disabled={pending} className={`btn w-full ${decision === "approved" ? "btn-primary" : "btn-danger"}`}>
        {pending ? "Saving…" : decision === "approved" ? "Approve" : "Request changes"}
      </button>
    </ModalShell>
  );
}
