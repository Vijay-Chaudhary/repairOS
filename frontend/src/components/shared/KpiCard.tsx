import { type LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type KpiVariant = 'default' | 'success' | 'warning' | 'danger';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  variant?: KpiVariant;
  trend?: { value: number; label?: string };
  loading?: boolean;
  className?: string;
}

const iconBoxStyles: Record<KpiVariant, string> = {
  default: 'bg-[var(--accent)]/10 text-[var(--accent)]',
  success: 'bg-[var(--success)]/10 text-[var(--success)]',
  warning: 'bg-[var(--warning)]/10 text-[var(--warning)]',
  danger:  'bg-[var(--danger)]/10 text-[var(--danger)]',
};

export function KpiCard({ title, value, subtitle, icon: Icon, variant = 'default', trend, loading, className }: KpiCardProps) {
  return (
    <div className={cn('rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 flex-1 min-w-0">
          <p className="text-body-sm text-[var(--text-muted)] truncate">{title}</p>
          {loading ? (
            <div className="h-8 w-24 animate-pulse rounded bg-[var(--surface-2)]" />
          ) : (
            <p className="text-h1 text-[var(--text)] font-semibold tabular-nums">{value}</p>
          )}
          {subtitle && <p className="text-body-sm text-[var(--text-muted)]">{subtitle}</p>}
          {trend && (
            <div className={cn('flex items-center gap-1 text-xs font-medium', trend.value >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
              {trend.value >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              <span>{Math.abs(trend.value)}%{trend.label ? ` ${trend.label}` : ''}</span>
            </div>
          )}
        </div>
        {Icon && (
          <div className={cn('rounded-md p-2 shrink-0', iconBoxStyles[variant])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </div>
  );
}
