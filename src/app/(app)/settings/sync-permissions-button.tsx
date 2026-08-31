"use client";

import { useState } from "react";
import { syncPermissionsAction } from "./actions";

export function SyncPermissionsButton() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const { changes } = await syncPermissionsAction();
      setResult(changes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sync permissions.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button onClick={run} disabled={pending} className="btn btn-secondary">
        {pending ? "Syncing…" : "Sync permissions now"}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-2 text-xs text-muted">
          {result.length === 0 ? (
            "Already up to date — nothing to change."
          ) : (
            <>
              <p className="mb-1 font-medium text-foreground">{result.length} change{result.length === 1 ? "" : "s"} applied:</p>
              <ul className="list-inside list-disc space-y-0.5">
                {result.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
