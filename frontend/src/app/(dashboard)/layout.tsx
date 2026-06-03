"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { useAuthStore } from "@/stores/auth.store";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, hydrateFromRefreshToken } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated) {
      hydrateFromRefreshToken().then((ok) => {
        if (!ok) router.replace("/login");
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 min-w-0 md:ml-0">
        <div className="p-4 md:p-6 pt-16 md:pt-6">{children}</div>
      </main>
    </div>
  );
}
