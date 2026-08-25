import type { RoleKey } from "./rbac";

export type NavItem = { href: string; label: string; icon: string };

/** Bottom tab bar (mobile) — kept to 5 items max per section 63/64. */
export function primaryNavFor(role: RoleKey): NavItem[] {
  if (role === "owner" || role === "manager") {
    return [
      { href: "/dashboard", label: "Dashboard", icon: "home" },
      { href: "/tasks", label: "Tasks", icon: "check" },
      { href: "/sites", label: "Sites", icon: "map" },
      { href: "/employees", label: "People", icon: "users" },
      { href: "/more", label: "More", icon: "grid" },
    ];
  }
  return [
    { href: "/home", label: "Home", icon: "home" },
    { href: "/tasks", label: "Tasks", icon: "check" },
    { href: "/attendance", label: "Attendance", icon: "clock" },
    { href: "/sites", label: "Sites", icon: "map" },
    { href: "/profile", label: "Profile", icon: "user" },
  ];
}

/** Everything else, reachable from "More" (mobile) or the sidebar (wide screens). */
export function secondaryNavFor(role: RoleKey): NavItem[] {
  const common: NavItem[] = [
    { href: "/leave", label: "Leave", icon: "calendar" },
    { href: "/documents", label: "Documents", icon: "file" },
    { href: "/materials", label: "Materials", icon: "package" },
    { href: "/notifications", label: "Notifications", icon: "bell" },
  ];
  if (role === "owner" || role === "manager") {
    return [
      { href: "/projects", label: "Projects", icon: "folder" },
      ...common,
      { href: "/reports", label: "Reports", icon: "chart" },
      { href: "/attendance/team", label: "Team Attendance", icon: "clock" },
      { href: "/audit", label: "Audit Log", icon: "shield" },
      { href: "/search", label: "Search", icon: "search" },
      { href: "/settings", label: "Settings", icon: "settings" },
      { href: "/profile", label: "Profile", icon: "user" },
    ];
  }
  return [...common, { href: "/search", label: "Search", icon: "search" }];
}
