import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { files as filesTable, notifications, roles, storageSettings, users } from "@/db/schema";

const GB = 1024 * 1024 * 1024;

/** Percent-used points that trigger a fresh notification (see checkStorageThresholdAndNotify). */
export const STORAGE_THRESHOLDS = [80, 90, 100] as const;

export async function getStorageSettings() {
  const existing = await db.query.storageSettings.findFirst({ where: eq(storageSettings.id, "singleton") });
  if (existing) return existing;
  // Lazily created on first read — see storage-settings.ts.
  const [created] = await db
    .insert(storageSettings)
    .values({ id: "singleton" })
    .onConflictDoNothing()
    .returning();
  return created ?? (await db.query.storageSettings.findFirst({ where: eq(storageSettings.id, "singleton") }))!;
}

export async function updateStorageCap(capGb: number, updatedBy: string) {
  await getStorageSettings();
  const [row] = await db
    .update(storageSettings)
    .set({ capGb, updatedBy })
    .where(eq(storageSettings.id, "singleton"))
    .returning();
  return row;
}

export type StorageUsage = Awaited<ReturnType<typeof getStorageUsage>>;

/**
 * Source of truth is our own `files` table (sum of sizeBytes), not a live
 * Cloudflare R2 API call — R2's usage/billing API needs its own account
 * token that we haven't asked the user to set up, and every byte we ever
 * store in R2 was written by saveFile() and recorded here first, so the
 * two stay in sync (aside from the rare case a delete's R2 call fails
 * after the DB row is already gone — see deleteFile in settings/storage).
 */
export async function getStorageUsage() {
  const [totals] = await db
    .select({
      totalBytes: sql<string>`coalesce(sum(${filesTable.sizeBytes}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(filesTable);

  const byKindRows = await db
    .select({
      kind: filesTable.kind,
      totalBytes: sql<string>`coalesce(sum(${filesTable.sizeBytes}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(filesTable)
    .groupBy(filesTable.kind);

  const settings = await getStorageSettings();
  const totalBytes = Number(totals?.totalBytes ?? 0);
  const capBytes = settings.capGb * GB;
  const usedPercent = capBytes > 0 ? (totalBytes / capBytes) * 100 : 0;

  return {
    totalBytes,
    fileCount: totals?.count ?? 0,
    byKind: byKindRows.map((k) => ({ kind: k.kind, totalBytes: Number(k.totalBytes), count: k.count })),
    capBytes,
    capGb: settings.capGb,
    usedPercent,
    settings,
  };
}

function thresholdBucket(usedPercent: number): number {
  let bucket = 0;
  for (const t of STORAGE_THRESHOLDS) {
    if (usedPercent >= t) bucket = t;
  }
  return bucket;
}

/**
 * Reactive storage check — no Vercel Cron needed for this first pass:
 * called from the owner dashboard (so it runs whenever an owner opens the
 * app) and from the Storage settings page itself. Idempotent per
 * threshold: only fires a new in-app notification when usage crosses
 * into a higher bucket than last notified, and resets the bucket down
 * when usage drops (e.g. after deleting old files) so a later climb back
 * past the same threshold notifies again instead of staying silent.
 */
export async function checkStorageThresholdAndNotify() {
  const usage = await getStorageUsage();
  const bucket = thresholdBucket(usage.usedPercent);
  if (bucket === usage.settings.lastNotifiedThreshold) return usage;

  if (bucket > usage.settings.lastNotifiedThreshold) {
    const recipients = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(inArray(roles.key, ["owner", "manager"]), eq(users.status, "active")));

    const usedGb = (usage.totalBytes / GB).toFixed(1);
    const title = bucket >= 100 ? "Cloud storage limit reached" : "Cloud storage nearing limit";
    const message =
      bucket >= 100
        ? `Storage is at ${usedGb} GB of the ${usage.capGb} GB plan (${Math.round(usage.usedPercent)}%). New uploads may start failing — free up space or raise the plan.`
        : `Storage is at ${usedGb} GB of the ${usage.capGb} GB plan (${Math.round(usage.usedPercent)}%). Review and delete old files to stay ahead of the limit.`;

    if (recipients.length > 0) {
      await db.insert(notifications).values(
        recipients.map((r) => ({
          recipientId: r.id,
          type: "storage_threshold",
          title,
          message,
          relatedEntityType: "storage",
          relatedEntityId: "singleton",
        }))
      );
    }
  }

  await db.update(storageSettings).set({ lastNotifiedThreshold: bucket }).where(eq(storageSettings.id, "singleton"));
  return usage;
}
