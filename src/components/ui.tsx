import Link from "next/link";
import { Icon } from "./icon";
import { statusClass, statusLabel } from "@/lib/format";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ status, children }: { status: string; children?: React.ReactNode }) {
  return <span className={`badge ${statusClass(status)}`}>{children ?? statusLabel(status)}</span>;
}

export function EmptyState({ icon = "grid", title, subtitle, action }: { icon?: string; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-background text-muted">
        <Icon name={icon} className="h-6 w-6" />
      </div>
      <p className="font-medium text-foreground">{title}</p>
      {subtitle && <p className="max-w-sm text-sm text-muted">{subtitle}</p>}
      {action}
    </div>
  );
}

export function StatCard({ label, value, icon, href, tone = "default" }: { label: string; value: string | number; icon: string; href?: string; tone?: "default" | "warning" | "danger" | "success" }) {
  const toneClass = {
    default: "text-brand-ink bg-slate-100",
    warning: "text-amber-700 bg-amber-100",
    danger: "text-red-700 bg-red-100",
    success: "text-emerald-700 bg-emerald-100",
  }[tone];
  const content = (
    <div className="card flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneClass}`}>
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-semibold leading-none text-foreground">{value}</div>
        <div className="mt-1 text-xs text-muted">{label}</div>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-transform hover:-translate-y-0.5">
      {content}
    </Link>
  ) : (
    content
  );
}

export function SectionCard({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4 md:p-5">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
