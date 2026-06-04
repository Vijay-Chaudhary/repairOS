import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div>
          <h1 className="text-display text-[var(--text)] font-semibold">RepairOS</h1>
          <p className="mt-2 text-body text-[var(--text-muted)]">
            Repair shop management — fast, mobile-first, built for India.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-11 px-6 rounded-md bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-medium hover:bg-[var(--accent)]/90 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center justify-center h-11 px-6 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-medium hover:bg-[var(--surface-2)] transition-colors"
          >
            Start free trial
          </Link>
        </div>
      </div>
    </main>
  );
}
