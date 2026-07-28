import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.ComponentProps<'select'>, 'size'> {
  options: SelectOption[];
  /** Rendered as a disabled first option when the value is empty. */
  placeholder?: string;
  size?: 'sm' | 'md';
}

/**
 * A native select with the chrome removed. Native beats a custom listbox here:
 * it is keyboard-correct, screen-reader-correct, and mobile-correct for free.
 */
export function Select({ className, options, placeholder, size = 'md', ...props }: SelectProps) {
  return (
    <div className="relative inline-flex w-full">
      <select
        {...props}
        className={cn(
          'w-full appearance-none rounded-md border border-zinc-200 bg-white pl-2.5 pr-7 text-zinc-900',
          'transition-colors focus:border-accent-600 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
          'dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-accent-500',
          size === 'sm' ? 'h-7 text-xs' : 'h-9 text-sm',
          className,
        )}
      >
        {placeholder ? (
          <option value="" disabled={props.required}>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className={cn(
          'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500',
          size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5',
        )}
      />
    </div>
  );
}
