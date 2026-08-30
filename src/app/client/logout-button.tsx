"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/client-auth/logout", { method: "POST" });
        router.push("/client/login");
        router.refresh();
      }}
      className="btn btn-secondary"
    >
      Sign out
    </button>
  );
}
