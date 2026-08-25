"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { recheckStorage } from "./actions";

export function RecheckButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      className="btn btn-secondary text-xs"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await recheckStorage();
          router.refresh();
        })
      }
    >
      {pending ? "Checking…" : "Recheck now"}
    </button>
  );
}
