"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCadModel } from "../actions";
import { Icon } from "@/components/icon";

/** For a model that was uploaded against the wrong drawing, parsed into garbage, or otherwise isn't worth keeping — see deleteCadModel's doc for the permission rule on approved models. */
export function DeleteModelButton({ modelId, modelName }: { modelId: string; modelName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    setError(null);
    if (!window.confirm(`Delete "${modelName}"? This removes the 3D model and everything read from its CAD file. This can't be undone.`)) return;
    startTransition(async () => {
      try {
        const { projectId } = await deleteCadModel(modelId);
        router.push(`/projects/${projectId}/cad`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete this model.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={onClick} disabled={pending} className="btn btn-danger">
        <Icon name="trash" className="h-4 w-4" /> {pending ? "Deleting…" : "Delete model"}
      </button>
      {error && <p className="max-w-[16rem] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
