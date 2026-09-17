"use client";
import * as React from 'react';
import { mayNavigate } from '@/lib/v2/presentation';
export function InspectorKeyboard() {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || !target || !mayNavigate(target.tagName, target.isContentEditable) || target.closest('[role="dialog"], [role="tablist"], [role="textbox"]')) return;
      const id = event.key === 'ArrowRight' ? 'v2-next-post' : event.key === 'ArrowLeft' ? 'v2-previous-post' : null;
      const link = id ? document.getElementById(id) : null;
      if (link instanceof HTMLAnchorElement) { event.preventDefault(); link.click(); }
    };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
