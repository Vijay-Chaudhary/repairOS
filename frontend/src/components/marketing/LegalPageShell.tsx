'use client';

import Link from 'next/link';
import { Wrench, ArrowLeft } from 'lucide-react';

interface TocItem {
  id: string;
  label: string;
}

interface LegalPageShellProps {
  title: string;
  effectiveDate: string;
  toc: TocItem[];
  children: React.ReactNode;
}

export function LegalPageShell({ title, effectiveDate, toc, children }: LegalPageShellProps) {
  return (
    <div className="min-h-dvh bg-[var(--bg)] flex flex-col">
      {/* Simple header */}
      <header className="sticky top-0 z-50 bg-[var(--surface)]/95 backdrop-blur-sm border-b border-[var(--border)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-14 gap-4">
            <Link href="/" className="flex items-center gap-2 shrink-0 min-h-[auto] min-w-[auto]">
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--accent)]">
                <Wrench className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-base font-semibold text-[var(--text)]">RepairOS</span>
            </Link>
            <div className="h-4 w-px bg-[var(--border)]" />
            <Link
              href="/"
              className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors min-h-[auto] min-w-[auto]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to home
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1">
        {/* Page hero */}
        <div className="border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl font-bold text-[var(--text)] tracking-tight">{title}</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Effective date: <time>{effectiveDate}</time>
            </p>
          </div>
        </div>

        {/* Content area */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
            {/* Sticky TOC — desktop only */}
            <aside className="hidden lg:block">
              <div className="sticky top-24">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                  On this page
                </p>
                <nav className="space-y-1">
                  {toc.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className="block text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors py-1 leading-snug min-h-[auto] min-w-[auto]"
                    >
                      {item.label}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>

            {/* Article */}
            <article className="prose-legal">
              {children}
            </article>
          </div>
        </div>
      </div>

      {/* Simple footer */}
      <footer className="border-t border-[var(--border)] bg-[var(--surface)] py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-[var(--text-muted)]">
            © {new Date().getFullYear()} RepairOS. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors min-h-[auto] min-w-[auto]">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors min-h-[auto] min-w-[auto]">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
