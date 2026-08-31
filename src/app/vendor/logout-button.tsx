"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/vendor-auth/logout", { method: "POST" });
        router.push("/vendor/login");
        router.refresh();
      }}
      className="btn btn-secondary"
    >
      Sign out
    </button>
  );
}
