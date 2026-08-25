import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { permissions, rolePermissions, roles } from "@/db/schema";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, ROLE_KEYS } from "@/lib/rbac";

export const maxDuration = 30;

/**
 * The one-time seed (see /api/setup/seed) is idempotent and skips once
 * `roles` has any rows — so a permission added to rbac.ts *after* first
 * deploy (like RECRUITMENT_MANAGE) never reaches the live
 * permissions/role_permissions tables on its own. This endpoint closes
 * that gap: it inserts any permission row that's missing, then grants
 * each role exactly the permissions DEFAULT_ROLE_PERMISSIONS says it
 * should have (adding what's missing, never removing something an owner
 * may have customized beyond the default — it only ever adds rows).
 * Safe to call repeatedly; each run reports only what actually changed.
 *
 * First version of this did one query per permission and per
 * role/permission pair (~90 sequential round trips) and timed out against
 * Supabase's pooled connection — rewritten to a handful of batched
 * queries instead.
 */
async function handle(req: NextRequest) {
  const secret = process.env.SETUP_SECRET;
  if (!secret) return NextResponse.json({ error: "SETUP_SECRET is not configured." }, { status: 403 });
  if (req.nextUrl.searchParams.get("secret") !== secret) return NextResponse.json({ error: "Invalid or missing secret." }, { status: 401 });

  const changes: string[] = [];

  const existingPermissions = await db.select({ key: permissions.key }).from(permissions);
  const existingPermKeys = new Set(existingPermissions.map((p) => p.key));
  const missingPerms = ALL_PERMISSIONS.filter((p) => !existingPermKeys.has(p.key));
  if (missingPerms.length > 0) {
    await db.insert(permissions).values(missingPerms.map((p) => ({ key: p.key, description: p.description })));
    changes.push(...missingPerms.map((p) => `created permission: ${p.key}`));
  }

  const allRoles = await db.select({ id: roles.id, key: roles.key }).from(roles);
  const roleIdByKey = new Map(allRoles.map((r) => [r.key, r.id]));

  const existingGrants = await db.select({ roleId: rolePermissions.roleId, permissionKey: rolePermissions.permissionKey }).from(rolePermissions);
  const existingGrantSet = new Set(existingGrants.map((g) => `${g.roleId}:${g.permissionKey}`));

  const toInsert: { roleId: string; permissionKey: string }[] = [];
  for (const roleKey of ROLE_KEYS) {
    const roleId = roleIdByKey.get(roleKey);
    if (!roleId) continue;
    for (const permKey of DEFAULT_ROLE_PERMISSIONS[roleKey]) {
      if (!existingGrantSet.has(`${roleId}:${permKey}`)) {
        toInsert.push({ roleId, permissionKey: permKey });
        changes.push(`granted ${permKey} to ${roleKey}`);
      }
    }
  }
  if (toInsert.length > 0) {
    await db.insert(rolePermissions).values(toInsert);
  }

  return NextResponse.json({ ok: true, changes });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
