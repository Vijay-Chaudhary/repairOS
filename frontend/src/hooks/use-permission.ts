"use client";

import { useAuthStore } from "@/stores/auth.store";
import type { PermissionCode } from "@/lib/permissions";

/**
 * Returns true if the authenticated user holds the given permission.
 * Platform admins always return true for every permission.
 */
export function usePermission(perm: PermissionCode): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  if (user.is_platform_admin) return true;
  return user.permissions.includes(perm);
}

/**
 * Returns true if the user holds ALL of the given permissions.
 */
export function usePermissions(...perms: PermissionCode[]): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  if (user.is_platform_admin) return true;
  return perms.every((p) => user.permissions.includes(p));
}

/**
 * Returns true if the user holds ANY of the given permissions.
 */
export function useAnyPermission(...perms: PermissionCode[]): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  if (user.is_platform_admin) return true;
  return perms.some((p) => user.permissions.includes(p));
}
