"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setVendorStatus } from "../actions";

export function StatusToggle({ vendorId, status }: { vendorId: string; status: "active" | "inactive" }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    startTransition(async () => {
      await setVendorStatus(vendorId, status === "active" ? "inactive" : "active");
      router.refresh();
    });
  }

  return (
    <button onClick={toggle} disabled={pending} className="btn btn-secondary text-xs">
      {status === "active" ? "Disable portal access" : "Re-enable portal access"}
    </button>
  );
}
