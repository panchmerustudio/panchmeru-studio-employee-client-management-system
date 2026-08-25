"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleFeatureFlag } from "./actions";

export function FlagToggle({ flagKey, enabled }: { flagKey: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      role="switch"
      aria-checked={enabled}
      disabled={pending}
      onClick={() => startTransition(async () => { await toggleFeatureFlag(flagKey, !enabled); router.refresh(); })}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-emerald-600" : "bg-slate-300"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}
