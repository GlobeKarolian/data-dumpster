'use client';

import * as React from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type Side = 'top' | 'bottom';
type Align = 'start' | 'center' | 'end';

export interface TooltipProps {
  /** Rich tooltip body. Strings are rendered as a single paragraph. */
  content: React.ReactNode;
  children: React.ReactElement;
  side?: Side;
  align?: Align;
  /** Widen for definition copy; the default suits short labels. */
  wide?: boolean;
  /** Let chart segments size the tooltip trigger wrapper inside a stacked bar. */
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
}

/**
 * Hover and keyboard accessible tooltip.
 *
 * Focus opens it as reliably as hover does, because the metric definitions this
 * carries are the product's honesty guarantee and a keyboard user is entitled to
 * exactly the same explanation a mouse user gets.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  wide,
  wrapperClassName,
  wrapperStyle,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();

  const handlers = {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    },
  };

  // When a Server Component (DeltaBadge, for one) passes the trigger, React
  // can deliver it as a lazy reference rather than an element; dev always
  // does. cloneElement on a lazy reference yields an element whose type is
  // undefined, which failed the server render of every screen with a delta
  // badge ("Element type is invalid ... got: undefined"). Only clone real
  // elements; otherwise the wrapper carries the handlers. Focus and hover
  // events bubble in React, so behavior is the same either way.
  const cloneable = React.isValidElement(children);
  const trigger = cloneable
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        'aria-describedby': open ? id : undefined,
        ...handlers,
      })
    : children;

  return (
    <span
      className={cn('relative inline-flex', wrapperClassName)}
      style={wrapperStyle}
      {...(cloneable ? {} : { ...handlers, 'aria-describedby': open ? id : undefined })}
    >
      {trigger}
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-50 rounded-md border px-3 py-2 text-left text-xs font-normal leading-relaxed shadow-lg',
            'border-zinc-200 bg-white text-zinc-700',
            'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200',
            wide ? 'w-80' : 'w-max max-w-xs',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            align === 'center' && 'left-1/2 -translate-x-1/2',
            align === 'start' && 'left-0',
            align === 'end' && 'right-0',
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

/**
 * True inside a control that is already a <button> (a sortable table header,
 * a toggle). HTML forbids a <button> inside a <button>: the parser closes the
 * outer one early, so server HTML and the client tree disagree and React
 * discards the whole page on hydration (React error #418 on Posted URLs).
 */
export const InsideInteractiveContext = React.createContext(false);

/** The small circled "i" that sits beside every metric label in the product. */
export function InfoTip({
  content,
  label,
  side = 'top',
  align = 'center',
}: {
  content: React.ReactNode;
  label: string;
  side?: Side;
  align?: Align;
}) {
  const nested = React.useContext(InsideInteractiveContext);
  const className = cn(
    'relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors',
    "after:absolute after:-inset-2 after:content-['']",
    'hover:text-accent-600 dark:text-zinc-600 dark:hover:text-accent-500',
  );
  const icon = <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />;
  return (
    <Tooltip content={content} side={side} align={align} wide>
      {nested ? (
        // Still focusable, so keyboard users get the definition; the click is
        // kept from reaching the enclosing control so asking what a column
        // means does not also re-sort it.
        <span
          role="button"
          tabIndex={0}
          aria-label={'How ' + label + ' is calculated'}
          className={cn(className, 'cursor-help')}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
        >
          {icon}
        </span>
      ) : (
        <button type="button" aria-label={'How ' + label + ' is calculated'} className={className}>
          {icon}
        </button>
      )}
    </Tooltip>
  );
}
