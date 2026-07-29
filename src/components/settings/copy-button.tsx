'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';

/**
 * Copy to clipboard, with an honest failure state.
 *
 * The Clipboard API needs a secure context, so on a plain-http staging host the
 * write silently rejects. Since the value being copied here is the only way an
 * invited person ever reaches the app, a button that appears to work and does
 * not is worse than no button: it tells the administrator to send a link they
 * do not have. When the write fails this says so and selects the text instead.
 */
export function CopyButton({
  value,
  label = 'Copy link',
  copiedLabel = 'Copied',
  selectTargetId,
  ...rest
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  /** Input to select when the clipboard is unavailable, so it can be copied by hand. */
  selectTargetId?: string;
} & Omit<ButtonProps, 'value' | 'onClick' | 'children'>) {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle');

  React.useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
      if (selectTargetId) {
        const el = document.getElementById(selectTargetId);
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.focus();
          el.select();
        }
      }
    }
  };

  return (
    <Button
      {...rest}
      type="button"
      onClick={copy}
      aria-live="polite"
      title={state === 'failed' ? 'The clipboard is unavailable here. The link is selected instead.' : undefined}
    >
      {state === 'copied' ? (
        <Check className="h-3 w-3" aria-hidden />
      ) : (
        <Copy className="h-3 w-3" aria-hidden />
      )}
      {state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy it by hand' : label}
    </Button>
  );
}
