import { AuthBrandPanel } from '@/components/auth/AuthBrandPanel';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-[var(--surface)]">
      <AuthBrandPanel />
      <div className="flex-1 flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
