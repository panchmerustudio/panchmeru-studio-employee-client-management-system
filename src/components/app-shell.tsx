"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./icon";
import type { NavItem } from "@/lib/nav";

export function AppShell({
  primary,
  secondary,
  userName,
  roleName,
  unreadCount,
  children,
}: {
  primary: NavItem[];
  secondary: NavItem[];
  userName: string;
  roleName: string;
  unreadCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface md:flex md:flex-col">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-ink text-sm font-bold text-white">PS</div>
          <div>
            <div className="text-sm font-semibold leading-tight">Panchmeru Studio</div>
            <div className="text-xs text-muted">{roleName}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {[...primary.filter((i) => i.href !== "/more"), ...secondary].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                isActive(item.href) ? "bg-brand-ink text-white" : "text-foreground hover:bg-background"
              }`}
            >
              <Icon name={item.icon} className="h-4 w-4" />
              {item.label}
              {item.href === "/notifications" && unreadCount > 0 && (
                <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">{unreadCount}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <div className="mb-2 truncate px-2 text-sm font-medium">{userName}</div>
          <button onClick={logout} className="btn btn-secondary w-full">
            <Icon name="log-out" className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-ink text-xs font-bold text-white">PS</div>
          <span className="text-sm font-semibold">Panchmeru Studio</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/notifications" className="relative text-foreground">
            <Icon name="bell" className="h-5 w-5" />
            {unreadCount > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />}
          </Link>
        </div>
      </header>

      <main className="flex-1 pb-20 md:pb-0">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-8 md:py-8">{children}</div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-border bg-surface/95 backdrop-blur md:hidden">
        {primary.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
              isActive(item.href) ? "text-accent" : "text-muted"
            }`}
          >
            <Icon name={item.icon} className="h-5 w-5" />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
