import * as React from 'react';
import { cn } from '@/lib/utils';

const BASE =
  'w-full rounded-md border border-zinc-200 bg-white text-sm text-zinc-900 placeholder:text-zinc-400 ' +
  'transition-colors focus:border-accent-600 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ' +
  'dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-accent-500';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input {...props} className={cn(BASE, 'h-9 px-2.5', className)} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea {...props} className={cn(BASE, 'min-h-[5rem] resize-y px-2.5 py-2 leading-relaxed', className)} />;
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      {...props}
      className={cn('block text-xs font-medium text-zinc-700 dark:text-zinc-300', className)}
    />
  );
}

export function FieldHint({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      {...props}
      className={cn('text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500', className)}
    />
  );
}

export function FieldError({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      {...props}
      role="alert"
      className={cn('text-[11px] leading-relaxed text-red-600 dark:text-red-400', className)}
    />
  );
}

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  /** Rendered to the right of the label, e.g. a docs link. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, error, aside, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {aside}
      </div>
      {children}
      {error ? <FieldError>{error}</FieldError> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

/** Search box with a leading icon slot. */
export function SearchInput({
  className,
  icon,
  ...props
}: React.ComponentProps<'input'> & { icon?: React.ReactNode }) {
  return (
    <div className="relative">
      {icon ? (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-600">
          {icon}
        </span>
      ) : null}
      <input {...props} className={cn(BASE, 'h-9 pr-2.5', icon ? 'pl-8' : 'pl-2.5', className)} />
    </div>
  );
}
