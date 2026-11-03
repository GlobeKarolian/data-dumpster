/**
 * A small ring buffer of recent browser errors, attached to bug reports so
 * "the page broke" arrives with the error that broke it. Installed once per
 * page load; keeps messages only, never request bodies or storage.
 */
const MAX = 20;
const buffer: string[] = [];
let installed = false;

function push(message: string) {
  const line = new Date().toISOString().slice(11, 19) + ' ' + message.slice(0, 900);
  buffer.push(line);
  if (buffer.length > MAX) buffer.shift();
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.name + ': ' + value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function installConsoleBuffer(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => {
    push('error: ' + (event.message || describe(event.error)));
  });
  window.addEventListener('unhandledrejection', (event) => {
    push('unhandled rejection: ' + describe(event.reason));
  });
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    push('console.error: ' + args.map(describe).join(' '));
    original(...args);
  };
}

export function recentConsoleErrors(): string[] {
  return [...buffer];
}
