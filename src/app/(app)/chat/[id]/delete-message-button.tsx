"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMessage } from "../actions";
import { Icon } from "@/components/icon";

export function DeleteMessageButton({ messageId }: { messageId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    setError(null);
    if (!window.confirm("Delete this message? This can't be undone.")) return;
    startTransition(async () => {
      try {
        await deleteMessage(messageId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete this message.");
      }
    });
  }

  return (
    <span className="relative">
      <button onClick={onClick} disabled={pending} aria-label="Delete message" className="text-current opacity-60 hover:opacity-100 disabled:opacity-30">
        <Icon name="trash" className="h-3.5 w-3.5" />
      </button>
      {error && <span className="absolute right-0 top-full z-10 mt-1 w-40 rounded bg-red-600 px-2 py-1 text-[10px] text-white">{error}</span>}
    </span>
  );
}
