"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveMissingInput } from "../actions";
import type { CadUnits } from "@/lib/dxf";
import { formatMm, unitSuffix, unitValueToMm } from "@/lib/cad-units";

const PRESETS: Record<string, number[]> = {
  floor_height: [2700, 3000, 3200, 3500],
  door_height: [2100, 2400],
  window_height: [1200, 1500, 1800],
  window_sill_height: [600, 900, 1050],
  wall_default_thickness: [100, 115, 150, 230, 300],
};

export type MissingInputRowData = {
  id: string;
  kind: string;
  question: string;
  resolvedValueMm: number | null;
  confirmed: boolean; // true once a person has explicitly set/confirmed this value; false = still unset, or set only by the automatic default
};

/**
 * Two modes, same component: `blocking` (a genuinely-pending question,
 * still gating this model's 3D generation — only reachable for models
 * uploaded before defaults were auto-applied) vs. review (every
 * measurement already has a value — automatic or person-confirmed — and
 * this is just "here's what was assumed, change it if this drawing is
 * different").
 */
export function MissingInfoForm({ modelId, inputs, units, blocking }: { modelId: string; inputs: MissingInputRowData[]; units: CadUnits; blocking: boolean }) {
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {blocking
          ? "A plan-view CAD drawing doesn't contain this information — nothing here is guessed. Answer each question below to unlock 3D generation."
          : "A plan-view CAD drawing doesn't contain these measurements, so the model below was built with common, sensible defaults — nothing here is guessed at random, and none of it blocked the 3D model from being generated. Review and change any of them if this drawing is different."}
        {units !== "mm" && ` Shown in ${unitSuffix(units)}, matching how this drawing was uploaded.`}
      </p>
      {inputs.map((input) => (
        <MissingInputRow key={input.id} modelId={modelId} input={input} units={units} />
      ))}
    </div>
  );
}

function MissingInputRow({ modelId, input, units }: { modelId: string; input: MissingInputRowData; units: CadUnits }) {
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{input.question}</p>
        {input.resolvedValueMm != null && (
          <span className={`badge ${input.confirmed ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"}`}>
            {input.confirmed ? "Confirmed: " : "Assumed: "}
            {formatMm(input.resolvedValueMm, units)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button key={p} disabled={pending} onClick={() => submit(p)} className={`btn ${p === input.resolvedValueMm ? "btn-primary" : "btn-secondary"}`}>
            {formatMm(p, units)}
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
              min={0.01}
              step="any"
              className="input w-28"
              placeholder={unitSuffix(units)}
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              autoFocus
            />
            <button
              disabled={pending || !customValue}
              onClick={() => submit(Math.round(unitValueToMm(Number(customValue), units)))}
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
