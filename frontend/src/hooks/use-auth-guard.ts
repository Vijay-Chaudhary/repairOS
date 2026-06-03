"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth.store";

export function useAuthGuard() {
  const router = useRouter();
  const { isAuthenticated, isLoading, hydrateFromRefreshToken } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      hydrateFromRefreshToken().then((ok) => {
        if (!ok) router.replace("/login");
      });
    }
  }, [isAuthenticated, isLoading, hydrateFromRefreshToken, router]);

  return { isLoading, isAuthenticated };
}
