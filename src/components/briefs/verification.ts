import type { BriefVerification, NumericClaim } from '@/lib/ai/verify';

/**
 * The verification record is stored as jsonb alongside the brief, so it arrives
 * typed as unknown. This narrows it defensively: a brief written before a
 * verification field existed should render as "not verified" rather than throw,
 * because the honest failure mode of a trust feature is to admit it has nothing
 * to show.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toClaim(value: unknown): NumericClaim | null {
  if (!isRecord(value)) return null;
  if (typeof value.text !== 'string' || typeof value.raw !== 'string') return null;
  const nearest = isRecord(value.nearest)
    && typeof value.nearest.path === 'string'
    && typeof value.nearest.value === 'number'
    && typeof value.nearest.delta === 'number'
      ? { path: value.nearest.path, value: value.nearest.value, delta: value.nearest.delta }
      : undefined;
  return {
    text: value.text,
    raw: value.raw,
    value: typeof value.value === 'number' ? value.value : Number.NaN,
    found: value.found === true,
    citedPath: typeof value.citedPath === 'string' ? value.citedPath : undefined,
    matchedPath: typeof value.matchedPath === 'string' ? value.matchedPath : undefined,
    nearest,
  };
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function parseVerification(facts: unknown): BriefVerification | null {
  if (!isRecord(facts)) return null;
  const raw = facts.verification;
  if (!isRecord(raw)) return null;

  const claims = Array.isArray(raw.claims)
    ? raw.claims.map(toClaim).filter((c): c is NumericClaim => c !== null)
    : [];

  const stats = isRecord(raw.stats) ? raw.stats : {};

  return {
    ok: raw.ok === true,
    claims,
    unverified: toStrings(raw.unverified),
    violations: toStrings(raw.violations),
    missingCaveats: toStrings(raw.missingCaveats),
    miscited: toStrings(raw.miscited),
    stats: {
      total: typeof stats.total === 'number' ? stats.total : claims.length,
      grounded: typeof stats.grounded === 'number' ? stats.grounded : claims.filter((c) => c.found).length,
      cited: typeof stats.cited === 'number' ? stats.cited : claims.filter((c) => c.citedPath).length,
    },
    checkedAt: typeof raw.checkedAt === 'string' ? raw.checkedAt : '',
  };
}

/** Readable form of a fact-sheet path, for people who did not write the schema. */
export function humanizePath(path: string): string {
  return path
    .replace(/^facts\./, '')
    .replace(/\[(\d+)\]/g, ' #$1')
    .replace(/\./g, ' › ');
}
