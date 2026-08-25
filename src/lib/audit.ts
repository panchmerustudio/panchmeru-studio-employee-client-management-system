import "server-only";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { headers } from "next/headers";
import type { CurrentUser } from "./auth";

/**
 * Section 42: every important action gets a WHO / WHAT / WHEN / previous
 * state / new state row. Call this from server actions right after the
 * mutation succeeds.
 */
export async function recordAudit(opts: {
  actor: CurrentUser | null;
  action: string;
  entityType: string;
  entityId: string;
  previousState?: unknown;
  newState?: unknown;
}) {
  let ip: string | undefined;
  try {
    const hdrs = await headers();
    ip = hdrs.get("x-forwarded-for") ?? undefined;
  } catch {
    // not in a request context (e.g. called from a script) — fine to omit
  }
  await db.insert(auditLogs).values({
    actorId: opts.actor?.id,
    actorRole: opts.actor?.roleKey,
    action: opts.action,
    entityType: opts.entityType,
    entityId: opts.entityId,
    previousState: opts.previousState ?? null,
    newState: opts.newState ?? null,
    ipAddress: ip,
  });
}
