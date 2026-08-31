import type { RoleKey } from "./rbac";

export type NavItem = { href: string; label: string; icon: string };

/**
 * Bottom tab bar (mobile) — kept to 5 items max per section 63/64. Every
 * role's list MUST end with a "/more" tab: the mobile shell has no
 * hamburger/menu button (see app-shell.tsx), so "More" is the only route
 * from the bottom bar into secondaryNavFor()'s items (Projects, Documents,
 * Plot Surveys, Chat, Leave, Materials, Search, Profile, and — for
 * owner/manager — Clients/Reports/Settings/etc). Dropping it for a role, as
 * used to be the case for supervisor/employee, silently strands every page
 * that isn't in this list on mobile for that role, even though the pages
 * themselves work fine and are linked from the desktop sidebar.
 */
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
    { href: "/more", label: "More", icon: "grid" },
  ];
}

/** Everything else, reachable from "More" (mobile) or the sidebar (wide screens). */
export function secondaryNavFor(role: RoleKey): NavItem[] {
  const common: NavItem[] = [
    { href: "/projects", label: "Projects", icon: "folder" }, // view-only for non-managers; supervisors reach the 3D Modeler through here
    { href: "/chat", label: "Chat", icon: "message" },
    { href: "/leave", label: "Leave", icon: "calendar" },
    { href: "/documents", label: "Documents", icon: "file" },
    { href: "/materials", label: "Materials", icon: "package" },
    { href: "/surveys", label: "Plot Surveys", icon: "ruler" },
    { href: "/notifications", label: "Notifications", icon: "bell" },
  ];
  if (role === "owner" || role === "manager") {
    return [
      ...common,
      { href: "/clients", label: "Clients", icon: "users" },
      { href: "/reports", label: "Reports", icon: "chart" },
      { href: "/attendance/team", label: "Team Attendance", icon: "clock" },
      { href: "/audit", label: "Audit Log", icon: "shield" },
      { href: "/recruitment", label: "Recruitment", icon: "briefcase" },
      { href: "/search", label: "Search", icon: "search" },
      { href: "/settings", label: "Settings", icon: "settings" },
      { href: "/profile", label: "Profile", icon: "user" },
    ];
  }
  return [...common, { href: "/search", label: "Search", icon: "search" }, { href: "/profile", label: "Profile", icon: "user" }];
}
