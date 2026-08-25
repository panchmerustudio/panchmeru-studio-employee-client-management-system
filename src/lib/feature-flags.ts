import { db } from "@/db/client";
import { featureFlags } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Section 66. Every future module is represented by a flag here, seeded
 * OFF. Current-version screens never render Clients/Commercials nav items
 * unless the corresponding flag is on (see components/layout/nav.tsx).
 */
export const FEATURE_FLAG_DEFS = [
  { key: "CLIENT_MANAGEMENT", name: "Client Management", description: "Client profiles, contacts, project/site linkage" },
  { key: "CLIENT_PORTAL", name: "Client Portal", description: "Client login to view their own projects" },
  { key: "CLIENT_DRAWING_APPROVAL", name: "Client Drawing Approval", description: "Client approve/request-revision on drawings" },
  { key: "COMMERCIALS", name: "Commercials", description: "Quotations, estimates, BOQ, invoices, payments" },
  { key: "VENDOR_MANAGEMENT", name: "Vendor Management", description: "Vendor directory & performance" },
  { key: "ADVANCED_INVENTORY", name: "Advanced Inventory", description: "Material stock & usage tracking" },
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_DEFS)[number]["key"];

let cache: { data: Record<string, boolean>; expiresAt: number } | null = null;

export async function getFeatureFlags(): Promise<Record<string, boolean>> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  const rows = await db.select().from(featureFlags);
  const data: Record<string, boolean> = {};
  for (const row of rows) data[row.key] = row.enabled;
  cache = { data, expiresAt: Date.now() + 5000 };
  return data;
}

export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  const flags = await getFeatureFlags();
  return !!flags[key];
}

export async function setFeatureFlag(key: string, enabled: boolean, updatedBy: string) {
  await db.update(featureFlags).set({ enabled, updatedBy }).where(eq(featureFlags.key, key));
  cache = null;
}
