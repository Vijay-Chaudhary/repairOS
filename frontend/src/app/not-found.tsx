import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="text-center space-y-4">
        <p className="text-display font-semibold text-[var(--text-muted)]">404</p>
        <h1 className="text-h1 text-[var(--text)]">Page not found</h1>
        <p className="text-body-sm text-[var(--text-muted)]">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/dashboard" className="inline-flex items-center justify-center h-11 px-4 rounded-md bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-medium hover:opacity-90">
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
