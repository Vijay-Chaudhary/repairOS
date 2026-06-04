import { money } from '@/lib/format/money';
import { Separator } from '@/components/ui/separator';

interface GstBreakdownProps {
  subtotal: number;
  gstRate: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  total: number;
}

export function GstBreakdown({ subtotal, gstRate, cgst, sgst, igst, total }: GstBreakdownProps) {
  const isInterState = igst !== undefined;
  const halfRate = gstRate / 2;

  return (
    <div className="space-y-2 text-body-sm">
      <div className="flex justify-between text-[var(--text-muted)]">
        <span>Subtotal</span>
        <span className="font-mono-num tabular-nums">{money(subtotal)}</span>
      </div>
      {isInterState ? (
        <div className="flex justify-between text-[var(--text-muted)]">
          <span>IGST ({gstRate}%)</span>
          <span className="font-mono-num tabular-nums">{money(igst)}</span>
        </div>
      ) : (
        <>
          <div className="flex justify-between text-[var(--text-muted)]">
            <span>CGST ({halfRate}%)</span>
            <span className="font-mono-num tabular-nums">{money(cgst ?? 0)}</span>
          </div>
          <div className="flex justify-between text-[var(--text-muted)]">
            <span>SGST ({halfRate}%)</span>
            <span className="font-mono-num tabular-nums">{money(sgst ?? 0)}</span>
          </div>
        </>
      )}
      <Separator />
      <div className="flex justify-between font-semibold text-[var(--text)]">
        <span>Total</span>
        <span className="font-mono-num tabular-nums">{money(total)}</span>
      </div>
    </div>
  );
}
