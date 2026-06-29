import Link from 'next/link';
import { Construction } from 'lucide-react';

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <Construction className="h-12 w-12 text-[var(--text-muted)]" aria-hidden />
      <div>
        <h1 className="text-h1 font-semibold text-[var(--text)]">{title}</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-1">This feature is coming soon.</p>
      </div>
      <Link href="/dashboard" className="text-sm text-[var(--accent)] hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
