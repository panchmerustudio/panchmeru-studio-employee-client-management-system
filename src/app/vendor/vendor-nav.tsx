import Link from "next/link";
import { Icon } from "@/components/icon";

const TABS = [
  { href: "/vendor", label: "Home", icon: "home" },
  { href: "/vendor/drawings", label: "Drawings", icon: "file" },
] as const;

/** Just 2 tabs — a vendor's whole world is {assigned project(s)} x {granted category(ies)}, nothing else to navigate to. */
export function VendorNav({ active }: { active: (typeof TABS)[number]["href"] }) {
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
