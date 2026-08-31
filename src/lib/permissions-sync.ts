import "server-only";
import { db } from "@/db/client";
import { permissions, rolePermissions, roles } from "@/db/schema";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, ROLE_KEYS } from "./rbac";

/**
 * Shared by /api/setup/sync-permissions (secret-gated, for first bootstrap
 * or CLI/automation use before anyone can log in) and the owner-facing
 * "Sync permissions" button in Settings (session-gated, for every time
 * after that — see settings/actions.ts). Both call this one function so
 * there's only one place the actual sync logic lives.
 *
 * Inserts any permission row missing from `permissions`, then grants each
 * role exactly the permissions DEFAULT_ROLE_PERMISSIONS says it should
 * have — adding what's missing, never removing something an owner may
 * have customized beyond the default. Safe to call repeatedly; each run
 * reports only what actually changed.
 */
export async function syncPermissions(): Promise<{ changes: string[] }> {
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

  return { changes };
}
