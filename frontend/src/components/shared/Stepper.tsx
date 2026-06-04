'use client';

import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface Step {
  label: string;
  description?: string;
}

interface StepperProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export function Stepper({ steps, currentStep, className }: StepperProps) {
  return (
    <div className={cn('flex items-start', className)}>
      {steps.map((step, index) => {
        const isCompleted = index < currentStep;
        const isCurrent = index === currentStep;
        return (
          <div key={index} className="flex flex-1 items-start">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium transition-colors',
                  isCompleted && 'border-[var(--accent)] bg-[var(--accent)] text-white',
                  isCurrent && 'border-[var(--accent)] bg-[var(--surface)] text-[var(--accent)]',
                  !isCompleted && !isCurrent && 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : <span>{index + 1}</span>}
              </div>
              {step.description && (
                <div className="mt-1 text-center">
                  <p className={cn('text-xs font-medium', isCurrent ? 'text-[var(--text)]' : 'text-[var(--text-muted)]')}>
                    {step.label}
                  </p>
                </div>
              )}
              {!step.description && (
                <p className={cn('mt-1 text-xs font-medium text-center', isCurrent ? 'text-[var(--text)]' : 'text-[var(--text-muted)]')}>
                  {step.label}
                </p>
              )}
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-px mt-4 mx-2 transition-colors',
                  isCompleted ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
