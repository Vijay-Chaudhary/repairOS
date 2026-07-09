import { Money } from '@/components/shared/Money';
import type { StatementSection } from '@/lib/api/accounts';

interface StatementSectionTableProps {
  title: string;
  section: StatementSection;
}

/** One financial-statement section (P&L / Balance Sheet): depth-first nested rows + subtotal. */
export function StatementSectionTable({ title, section }: StatementSectionTableProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <h3 className="px-3 py-2 bg-[var(--surface-2)] text-body-sm font-semibold text-[var(--text)]">
        {title}
      </h3>
      <table className="w-full text-body-sm">
        <tbody>
          {section.rows.map((r) => (
            <tr key={r.account_id ?? r.name} className="border-t border-[var(--border)]">
              <td className="px-3 py-2 font-mono-num text-[var(--text-muted)] w-20">{r.code ?? '—'}</td>
              <td
                className={`px-3 py-2 ${r.total !== null ? 'font-medium' : ''}`}
                style={{ paddingLeft: `${0.75 + r.level * 1.25}rem` }}
              >
                {r.name}
              </td>
              <td className="px-3 py-2 text-right">
                <Money amount={r.amount} />
                {r.total !== null && (
                  <div className="text-xs text-[var(--text-muted)]">
                    Σ <Money amount={r.total} />
                  </div>
                )}
              </td>
            </tr>
          ))}
          {section.rows.length === 0 && (
            <tr className="border-t border-[var(--border)]">
              <td colSpan={3} className="px-3 py-4 text-center text-[var(--text-muted)]">
                No postings.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--border)] font-semibold bg-[var(--surface-2)]">
            <td className="px-3 py-2" colSpan={2}>Subtotal</td>
            <td className="px-3 py-2 text-right"><Money amount={section.subtotal} /></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
