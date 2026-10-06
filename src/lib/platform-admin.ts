import type { Role } from '@/auth';

/**
 * Named platform administrators satisfy every owner role gate. Organization
 * predicates and resource ownership checks still apply to tenant-private data;
 * owner-only deployment operations remain global by their existing contract.
 */
const PLATFORM_ADMIN_EMAILS = new Set([
  'matt@boston.com',
]);

export function isPlatformAdmin(email: string | null | undefined): boolean {
  return PLATFORM_ADMIN_EMAILS.has(email?.trim().toLowerCase() ?? '');
}

export function effectiveRole(
  email: string | null | undefined,
  role: Role,
): Role {
  return isPlatformAdmin(email) ? 'owner' : role;
}
