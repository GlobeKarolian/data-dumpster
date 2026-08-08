/**
 * The role vocabulary, in one place, importable from both sides of the wire.
 *
 * lib/session.ts is marked server-only because it reaches for the database, so
 * a client component cannot import the ordering from there. Duplicating the
 * array in a component was the alternative, and a privilege ladder that exists
 * twice is a privilege ladder that will eventually disagree with itself. This
 * module holds no secrets, touches no node builtins, and is safe in a browser
 * bundle; session.ts re-exports ROLE_ORDER from here so there is exactly one
 * definition of what outranks what.
 */
import type { Role } from '@/auth';

export type { Role };

/** Least privileged first. The index in this array IS the privilege level. */
export const ROLE_ORDER = ['viewer', 'editor', 'admin', 'owner'] as const;

export function rankRole(role: Role): number {
  return ROLE_ORDER.indexOf(role);
}

/** Non-throwing check. Ordering is viewer < editor < admin < owner. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return rankRole(role) >= rankRole(min);
}

export const ROLE_LABELS: Record<Role, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  admin: 'Admin',
  owner: 'Owner',
};

/**
 * One sentence per role, written for the person choosing one from a dropdown.
 * The authoritative, longer statement of what each role may do lives in the
 * header comment of lib/invites.ts; these are the same rules, compressed.
 */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: 'Reads assigned landscapes. Cannot change anything.',
  editor: 'Reads and edits assigned landscapes, including channels, companies, tags and reports.',
  admin: 'Accesses every landscape and manages users, data sources and model connections.',
  owner: 'Everything, including billing-level settings and transferring ownership.',
};

/** Dropdown options in privilege order, lowest first. */
export const ROLE_OPTIONS: { value: Role; label: string }[] = ROLE_ORDER.map((r) => ({
  value: r,
  label: ROLE_LABELS[r],
}));
