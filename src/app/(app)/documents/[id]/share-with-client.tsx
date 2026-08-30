"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { shareDocumentWithClient } from "../../clients/actions";
import { Icon } from "@/components/icon";

export function ShareWithClient({
  documentVersionId,
  clients,
}: {
  documentVersionId: string;
  projectId: string | null;
  siteId: string | null;
  clients: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (clients.length === 0) return null;

  async function share() {
    if (!clientId) return;
    setPending(true);
    setError(null);
    try {
      await shareDocumentWithClient(documentVersionId, clientId);
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't share this version.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-secondary">
        <Icon name="users" className="h-4 w-4" /> Share with client
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={pending || done}>
        <option value="">Choose client…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button onClick={share} disabled={!clientId || pending || done} className="btn btn-accent">
        {done ? "Shared" : pending ? "Sharing…" : "Share"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
