"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDocumentCategory, seedStandardDocumentCategories } from "./actions";

const initialState: { error?: string; ok?: boolean } = {};

export function DocumentCategories({ categories }: { categories: { key: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(addDocumentCategory, initialState);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [seeding, startTransition] = useTransition();
  const router = useRouter();

  function seedStandard() {
    startTransition(async () => {
      const result = await seedStandardDocumentCategories();
      setSeedMsg(result.added > 0 ? `Added ${result.added} standard categor${result.added === 1 ? "y" : "ies"}.` : "All standard categories already exist.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <span key={c.key} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            {c.name}
          </span>
        ))}
      </div>

      <form action={formAction} className="flex gap-2">
        <input name="name" placeholder="New category name, e.g. Electrical" className="input flex-1" />
        <button type="submit" disabled={pending} className="btn btn-secondary shrink-0">
          Add
        </button>
      </form>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <button type="button" onClick={seedStandard} disabled={seeding} className="btn btn-secondary text-xs">
          Add standard categories (Electrical, Plumbing, HVAC, Furniture, Flooring, Ceiling, Structural)
        </button>
      </div>
      {seedMsg && <p className="text-xs text-muted">{seedMsg}</p>}
    </div>
  );
}
