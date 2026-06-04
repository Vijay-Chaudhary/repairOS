import { cn } from '@/lib/utils';
import { money } from '@/lib/format/money';

interface MoneyProps {
  amount: number | string | null | undefined;
  className?: string;
  muted?: boolean;
}

export function Money({ amount, className, muted }: MoneyProps) {
  return (
    <span
      className={cn(
        'font-mono-num tabular-nums',
        muted && 'text-[var(--text-muted)]',
        className
      )}
    >
      {money(amount)}
    </span>
  );
}
