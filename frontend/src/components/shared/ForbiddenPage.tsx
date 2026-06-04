import { ShieldX } from 'lucide-react';
import Link from 'next/link';

export function ForbiddenPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
      <div className="rounded-full bg-[var(--danger)]/10 p-6 mb-4">
        <ShieldX className="h-10 w-10 text-[var(--danger)]" />
      </div>
      <h2 className="text-h1 text-[var(--text)]">Access denied</h2>
      <p className="mt-2 text-body-sm text-[var(--text-muted)] max-w-sm">
        You don&apos;t have permission to view this page. Contact your admin to request access.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex items-center justify-center h-11 px-4 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-medium hover:bg-[var(--surface-2)] transition-colors"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
