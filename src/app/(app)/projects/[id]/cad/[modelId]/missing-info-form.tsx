"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveMissingInput } from "../actions";

const PRESETS: Record<string, number[]> = {
  floor_height: [2700, 3000, 3200, 3500],
  door_height: [2100, 2400],
  window_height: [1200, 1500, 1800],
  window_sill_height: [600, 900, 1050],
  wall_default_thickness: [100, 115, 150, 230, 300],
};

type PendingInput = { id: string; kind: string; question: string };

export function MissingInfoForm({ modelId, inputs }: { modelId: string; inputs: PendingInput[] }) {
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        A plan-view CAD drawing doesn&apos;t contain this information — nothing here is guessed. Answer each question below to unlock 3D generation.
      </p>
      {inputs.map((input) => (
        <MissingInputRow key={input.id} modelId={modelId} input={input} />
      ))}
    </div>
  );
}

function MissingInputRow({ modelId, input }: { modelId: string; input: PendingInput }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function submit(valueMm: number) {
    setError(null);
    startTransition(async () => {
      try {
        await resolveMissingInput(modelId, input.id, valueMm);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save.");
      }
    });
  }

  const presets = PRESETS[input.kind] ?? [];

  return (
    <div className="card p-4">
      <p className="mb-3 text-sm">{input.question}</p>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button key={p} disabled={pending} onClick={() => submit(p)} className="btn btn-secondary">
            {p} mm
          </button>
        ))}
        {!customOpen ? (
          <button disabled={pending} onClick={() => setCustomOpen(true)} className="btn btn-secondary">
            Custom
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              className="input w-28"
              placeholder="mm"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              autoFocus
            />
            <button
              disabled={pending || !customValue}
              onClick={() => submit(Number(customValue))}
              className="btn btn-primary"
            >
              {pending ? "Saving…" : "Set"}
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
