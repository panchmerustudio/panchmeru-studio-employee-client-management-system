"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { grantVendorCategory, revokeVendorCategory } from "../actions";

type Access = { id: string; documentCategoryId: string; isDefault: boolean };

export function CategoryAccess({
  vendorId,
  access,
  categories,
}: {
  vendorId: string;
  access: Access[];
  categories: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const grantedByCategory = new Map(access.map((a) => [a.documentCategoryId, a]));

  function toggle(categoryId: string, currentlyGranted: Access | undefined) {
    startTransition(async () => {
      if (currentlyGranted) {
        await revokeVendorCategory(currentlyGranted.id, vendorId);
      } else {
        await grantVendorCategory(vendorId, categoryId);
      }
      router.refresh();
    });
  }

  if (categories.length === 0) {
    return <p className="text-sm text-muted">No drawing categories exist yet — add some from Settings first.</p>;
  }

  return (
    <div className="space-y-1.5">
      {categories.map((c) => {
        const granted = grantedByCategory.get(c.id);
        return (
          <label key={c.id} className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-background">
            <span>
              {c.name}
              {granted?.isDefault && <span className="ml-1.5 text-xs text-muted">(default for trade)</span>}
            </span>
            <input type="checkbox" checked={!!granted} disabled={pending} onChange={() => toggle(c.id, granted)} className="h-4 w-4" />
          </label>
        );
      })}
    </div>
  );
}
