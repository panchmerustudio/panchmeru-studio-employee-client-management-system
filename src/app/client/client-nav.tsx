import Link from "next/link";
import { Icon } from "@/components/icon";

const TABS = [
  { href: "/client", label: "Home", icon: "home" },
  { href: "/client/drawings", label: "Drawings", icon: "file" },
  { href: "/client/approved", label: "Approved", icon: "check-circle" },
  { href: "/client/revisions", label: "Revisions", icon: "edit" },
  { href: "/client/payments", label: "Payments", icon: "chart" },
] as const;

/**
 * Deliberately kept short (spec: "the client should NOT have to navigate
 * through complicated project-management screens") — Payments is the 5th
 * tab and only shows real numbers once a project's payment tracking is
 * switched on (see /client/payments's empty state otherwise). Rendered at
 * the top of every authenticated /client page rather than via a shared
 * layout, so the existing login/[shareId] routes didn't need restructuring
 * into a route group to pick it up.
 */
export function ClientNav({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <nav className="card flex items-center justify-between gap-1 p-1.5">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium ${
            active === t.href ? "bg-brand-ink text-white" : "text-muted hover:bg-background"
          }`}
        >
          <Icon name={t.icon} className="h-4 w-4" />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
