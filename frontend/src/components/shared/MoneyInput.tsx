'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number | string;
  onChange: (value: number) => void;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ className, value, onChange, onBlur, onFocus, ...props }, ref) => {
    const [display, setDisplay] = React.useState(
      value !== undefined && value !== '' ? String(value) : ''
    );
    // While the field is focused the user owns the display string; never override it.
    const editing = React.useRef(false);

    React.useEffect(() => {
      if (editing.current) return;
      const numVal = typeof value === 'string' ? parseFloat(value) : value;
      if (!isNaN(numVal) && numVal !== parseFloat(display)) {
        setDisplay(String(numVal));
      }
      // display intentionally excluded: only sync when external value changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value;
      setDisplay(raw);
      const parsed = parseFloat(raw);
      onChange(isNaN(parsed) ? 0 : parsed);
    }

    function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
      editing.current = true;
      onFocus?.(e);
    }

    function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
      editing.current = false;
      // Normalise the display to the canonical numeric form on blur so it
      // matches what the parent value holds (e.g. '' → '0', '1.' → '1').
      const parsed = parseFloat(display);
      setDisplay(isNaN(parsed) ? '0' : String(parsed));
      onBlur?.(e);
    }

    return (
      <div className="relative flex items-center">
        <span className="absolute left-3 text-[var(--text-muted)] text-sm select-none pointer-events-none">₹</span>
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={display}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={cn(
            'flex h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pl-7 pr-3 py-2 text-body text-[var(--text)] font-mono-num tabular-nums ring-offset-[var(--bg)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]',
            className
          )}
          {...props}
        />
      </div>
    );
  }
);
MoneyInput.displayName = 'MoneyInput';
