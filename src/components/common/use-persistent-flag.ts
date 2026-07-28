'use client';

import * as React from 'react';

const EVENT = 'pressbox:flag';

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    // Private browsing denies storage; the flag simply does not persist.
    return false;
  }
}

/**
 * A boolean that survives a reload.
 *
 * Read through useSyncExternalStore rather than an effect so the server
 * snapshot is explicit rather than an accidental first paint that then
 * corrects itself. Two tabs stay in step because writes broadcast.
 */
export function usePersistentFlag(key: string): [boolean, (next: boolean) => void] {
  const subscribe = React.useCallback((onChange: () => void) => {
    const handler = () => onChange();
    window.addEventListener('storage', handler);
    window.addEventListener(EVENT, handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener(EVENT, handler);
    };
  }, []);

  const value = React.useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );

  const set = React.useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // Nothing to persist to; the change still applies for this session.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );

  return [value, set];
}
