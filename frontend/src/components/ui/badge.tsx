import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-[var(--accent)] text-[var(--accent-fg)]',
        secondary: 'border-transparent bg-[var(--surface-2)] text-[var(--text)]',
        destructive: 'border-transparent bg-[var(--danger)] text-white',
        success: 'border-transparent bg-[var(--success)] text-white',
        warning: 'border-transparent bg-[var(--warning)] text-white',
        info: 'border-transparent bg-[var(--info)] text-white',
        outline: 'text-[var(--text)] border-[var(--border)]',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
