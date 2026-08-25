"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStorageCap } from "./actions";

export function CapForm({ currentCapGb }: { currentCapGb: number }) {
  const [value, setValue] = useState(String(currentCapGb));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const capGb = Number(value);
    startTransition(async () => {
      try {
        await setStorageCap(capGb);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't update the plan size.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div>
        <label className="mb-1 block text-xs text-muted" htmlFor="cap-gb">
          Plan size (GB)
        </label>
        <input id="cap-gb" type="number" min={1} max={5000} className="input w-28" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary">
        Save
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
