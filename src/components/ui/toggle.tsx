'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** Hide the visible label but keep it for assistive technology. */
  hideLabel?: boolean;
  description?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  hideLabel,
  description,
  disabled,
  id,
  className,
}: ToggleProps) {
  const generated = React.useId();
  const inputId = id ?? generated;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-4.5 w-8 shrink-0 items-center rounded-full transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-accent-600' : 'bg-zinc-300 dark:bg-zinc-700',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
      {hideLabel ? null : (
        <label htmlFor={inputId} className="cursor-pointer select-none">
          <span className="block text-xs font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
          {description ? (
            <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
              {description}
            </span>
          ) : null}
        </label>
      )}
    </div>
  );
}

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, onChange, label, disabled, className }: CheckboxProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-zinc-300 text-accent-600 accent-accent-600 dark:border-zinc-600"
      />
      {label}
    </label>
  );
}
