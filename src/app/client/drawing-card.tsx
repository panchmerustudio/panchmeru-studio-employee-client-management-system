import Link from "next/link";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { timeAgo } from "@/lib/format";
import type { ClientDrawingRow } from "@/lib/client-portal";

export function DrawingCard({ drawing }: { drawing: ClientDrawingRow }) {
  return (
    <Link href={`/client/${drawing.shareId}`} className="card flex items-center justify-between gap-3 p-3.5 hover:bg-background">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <Icon name="file" className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{drawing.documentName}</div>
          <div className="text-xs text-muted">
            {drawing.categoryName ?? "Uncategorized"} · V{drawing.versionNumber} · Shared {timeAgo(drawing.sharedAt)}
          </div>
        </div>
      </div>
      <Badge status={drawing.responseStatus} />
    </Link>
  );
}
