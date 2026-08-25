"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeSession, removeWebauthnCredential } from "./actions";
import { timeAgo } from "@/lib/format";

export function SessionsList({ sessions, currentToken }: { sessions: { id: string; userAgent: string | null; createdAt: Date; sessionToken: string }[]; currentToken?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <ul className="divide-y divide-border">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center justify-between py-2 text-sm">
          <div>
            <div className="font-medium">{s.userAgent?.slice(0, 40) ?? "Unknown device"} {s.sessionToken === currentToken && <span className="text-xs text-emerald-600">(this device)</span>}</div>
            <div className="text-xs text-muted">Signed in {timeAgo(s.createdAt)}</div>
          </div>
          {s.sessionToken !== currentToken && (
            <button disabled={pending} onClick={() => startTransition(async () => { await revokeSession(s.id); router.refresh(); })} className="text-xs font-medium text-red-600">
              Sign out
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CredentialsList({ credentials }: { credentials: { id: string; nickname: string | null; createdAt: Date }[] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <ul className="divide-y divide-border">
      {credentials.map((c) => (
        <li key={c.id} className="flex items-center justify-between py-2 text-sm">
          <div>
            <div className="font-medium">{c.nickname ?? "Device"}</div>
            <div className="text-xs text-muted">Registered {timeAgo(c.createdAt)}</div>
          </div>
          <button disabled={pending} onClick={() => startTransition(async () => { await removeWebauthnCredential(c.id); router.refresh(); })} className="text-xs font-medium text-red-600">
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
