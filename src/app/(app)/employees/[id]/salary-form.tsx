"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEmployeeSalary } from "../actions";

export function SalaryForm({ employeeId, monthlySalary }: { employeeId: string; monthlySalary: number | null }) {
  const [value, setValue] = useState(monthlySalary != null ? String(monthlySalary) : "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateEmployeeSalary(employeeId, value);
        setSaved(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <span className="text-sm text-muted">₹</span>
      <input
        type="number"
        min="0"
        step="1"
        className="input flex-1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Not set"
      />
      <button type="submit" disabled={pending} className="btn btn-secondary shrink-0">Save</button>
      {saved && <span className="text-xs text-emerald-600">Saved</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
