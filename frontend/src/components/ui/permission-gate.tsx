"use client";

import { usePermission, useAnyPermission } from "@/hooks/use-permission";
import type { PermissionCode } from "@/lib/permissions";

/**
 * Renders children only when the user holds the required permission.
 * Use `any` prop to require at least one of the listed permissions.
 */
export function PermissionGate({
  perm,
  any: anyOf,
  fallback = null,
  children,
}: {
  perm?: PermissionCode;
  any?: PermissionCode[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasSingle = usePermission(perm ?? ("" as PermissionCode));
  const hasAny    = useAnyPermission(...(anyOf ?? []));

  const allowed = perm ? hasSingle : anyOf ? hasAny : true;
  return allowed ? <>{children}</> : <>{fallback}</>;
}
