export function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = new Date(d);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

const STATUS_STYLES: Record<string, string> = {
  // task statuses
  to_do: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  submitted: "bg-amber-100 text-amber-700",
  modification_required: "bg-red-100 text-red-700",
  approved: "bg-emerald-100 text-emerald-700",
  overdue: "bg-red-100 text-red-700",
  rescheduled: "bg-purple-100 text-purple-700",
  cancelled: "bg-zinc-100 text-zinc-500",
  // leave / material / other
  pending: "bg-amber-100 text-amber-700",
  pending_review: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
  ordered: "bg-blue-100 text-blue-700",
  received: "bg-emerald-100 text-emerald-700",
  // job applications
  new: "bg-blue-100 text-blue-700",
  reviewing: "bg-amber-100 text-amber-700",
  shortlisted: "bg-purple-100 text-purple-700",
  hired: "bg-emerald-100 text-emerald-700",
  // site health
  normal: "bg-emerald-100 text-emerald-700",
  attention: "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
  // attendance
  present: "bg-emerald-100 text-emerald-700",
  absent: "bg-red-100 text-red-700",
  on_leave: "bg-amber-100 text-amber-700",
  half_day: "bg-blue-100 text-blue-700",
  // generic
  active: "bg-emerald-100 text-emerald-700",
  on_hold: "bg-amber-100 text-amber-700",
  completed: "bg-slate-100 text-slate-700",
  delayed: "bg-red-100 text-red-700",
  // plot surveys
  needs_review: "bg-amber-100 text-amber-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  superseded: "bg-zinc-100 text-zinc-500",
};

export function statusClass(status: string) {
  return STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700";
}

export function statusLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
