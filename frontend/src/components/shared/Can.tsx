'use client';

import { useAuthStore } from '@/lib/stores/authStore';

interface CanProps {
  permission?: string;
  anyOf?: string[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function Can({ permission, anyOf, fallback = null, children }: CanProps) {
  const { hasPermission, hasAnyPermission } = useAuthStore();

  const allowed = anyOf
    ? hasAnyPermission(anyOf)
    : permission
    ? hasPermission(permission)
    : true;

  return <>{allowed ? children : fallback}</>;
}
