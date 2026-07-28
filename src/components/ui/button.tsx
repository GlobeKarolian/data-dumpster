import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent-600 text-white hover:bg-accent-700 disabled:bg-accent-600/50 dark:disabled:bg-accent-600/40',
  secondary:
    'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800',
  ghost:
    'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
  danger:
    'border border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950/40',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 gap-1.5 px-2 text-xs',
  md: 'h-9 gap-2 px-3 text-sm',
  icon: 'h-8 w-8 justify-center',
};

export interface ButtonProps extends React.ComponentProps<'button'> {
  variant?: Variant;
  size?: Size;
}

export function Button({ className, variant = 'secondary', size = 'md', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex shrink-0 items-center rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    />
  );
}

/** Segmented control used for view switches such as table versus grid. */
export function ButtonGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      {...props}
      role="group"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-zinc-200 bg-zinc-50 p-0.5',
        'dark:border-zinc-800 dark:bg-zinc-900',
        className,
      )}
    />
  );
}

export function ButtonGroupItem({
  className,
  active,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      {...props}
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors',
        active
          ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
        className,
      )}
    />
  );
}
