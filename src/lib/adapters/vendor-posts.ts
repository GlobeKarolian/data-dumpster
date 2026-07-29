/**
 * Shared helpers for vendor-backed post reads.
 *
 * Facebook, X, Instagram and Threads all come back from the same vendor with
 * the same shape problems: numbers arrive as strings, dates arrive in three
 * formats, and field names differ per endpoint for the same concept. Rather
 * than repeat that coercion in four adapters, it lives here.
 *
 * Deliberately NOT a generic adapter factory. Each platform still owns its own
 * field mapping, because the mapping is where the platform's meaning lives and
 * a table of aliases would hide exactly the decisions worth reviewing.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** First present, non-empty value among the candidate keys. */
export function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** Coerce to a non-negative integer. Vendor payloads mix numbers and strings. */
export function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.trunc(v));
  if (typeof v === 'string') {
    const n = Number(v.replace(/[, ]/g, ''));
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return 0;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function toDate(v: unknown): Date | undefined {
  if (typeof v === 'number') {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/** The vendor's date filters use MM-DD-YYYY, not ISO. */
export function vendorDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return mm + '-' + dd + '-' + d.getUTCFullYear();
}
