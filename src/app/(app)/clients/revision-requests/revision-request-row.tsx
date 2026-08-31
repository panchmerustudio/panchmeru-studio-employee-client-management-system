"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignRevisionRequest, setRevisionRequestStatus } from "../actions";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo } from "@/lib/format";
import Link from "next/link";

type Request = {
  id: string;
  sequenceNumber: number;
  requestText: string;
  status: string;
  createdAt: Date;
  assignedEmployeeId: string | null;
  attachmentFileId: string | null;
  clientId: string;
  clientName: string;
  documentId: string;
  documentName: string;
  versionNumber: number;
};

const STATUS_OPTIONS = ["open", "assigned", "revised", "resent", "approved", "rejected"] as const;

export function RevisionRequestRow({ request, employees, attachmentMimeType }: { request: Request; employees: { id: string; name: string }[]; attachmentMimeType?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function assign(employeeId: string) {
    startTransition(async () => {
      await assignRevisionRequest(request.id, employeeId || null);
      router.refresh();
    });
  }

  function changeStatus(status: string) {
    startTransition(async () => {
      await setRevisionRequestStatus(request.id, status as (typeof STATUS_OPTIONS)[number]);
      router.refresh();
    });
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">
            #{String(request.sequenceNumber).padStart(3, "0")} · {request.clientName} · {request.documentName} V{request.versionNumber}
          </div>
          <p className="mt-1 text-sm text-muted">{request.requestText}</p>
          {request.attachmentFileId && (
            <a href={`/api/files/${request.attachmentFileId}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-ink underline">
              <Icon name={attachmentMimeType?.startsWith("audio/") ? "mic" : "camera"} className="h-3 w-3" />
              View attachment
            </a>
          )}
          <p className="mt-1 text-xs text-muted">
            {timeAgo(request.createdAt)} ·{" "}
            <Link href={`/documents/${request.documentId}`} className="underline">
              Open document
            </Link>{" "}
            ·{" "}
            <Link href={`/clients/${request.clientId}`} className="underline">
              Open client
            </Link>
          </p>
        </div>
        <Badge status={request.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <select value={request.assignedEmployeeId ?? ""} onChange={(e) => assign(e.target.value)} disabled={pending} className="input w-auto text-xs">
          <option value="">Unassigned</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select value={request.status} onChange={(e) => changeStatus(e.target.value)} disabled={pending} className="input w-auto text-xs">
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
