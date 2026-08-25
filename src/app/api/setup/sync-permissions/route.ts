import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
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
 */
async function handle(req: NextRequest) {
  const secret = process.env.SETUP_SECRET;
  if (!secret) return NextResponse.json({ error: "SETUP_SECRET is not configured." }, { status: 403 });
  if (req.nextUrl.searchParams.get("secret") !== secret) return NextResponse.json({ error: "Invalid or missing secret." }, { status: 401 });

  const changes: string[] = [];

  for (const perm of ALL_PERMISSIONS) {
    const existing = await db.query.permissions.findFirst({ where: eq(permissions.key, perm.key) });
    if (!existing) {
      await db.insert(permissions).values({ key: perm.key, description: perm.description });
      changes.push(`created permission: ${perm.key}`);
    }
  }

  for (const roleKey of ROLE_KEYS) {
    const role = await db.query.roles.findFirst({ where: eq(roles.key, roleKey) });
    if (!role) continue;
    for (const permKey of DEFAULT_ROLE_PERMISSIONS[roleKey]) {
      const existing = await db.query.rolePermissions.findFirst({
        where: and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.permissionKey, permKey)),
      });
      if (!existing) {
        await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: permKey });
        changes.push(`granted ${permKey} to ${roleKey}`);
      }
    }
  }

  return NextResponse.json({ ok: true, changes });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
