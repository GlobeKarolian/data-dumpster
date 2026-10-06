/**
 * Publishing is a named-user capability while it is a prototype: it can post
 * to the newsroom's own accounts, so it is limited to the people below plus
 * anyone listed in PUBLISHING_EMAILS (comma separated). The API checks again;
 * the shell flag only hides the sidebar item. Everyone else gets a 404.
 *
 * Inside that group, admins and owners approve. Editors and viewers can draft
 * and submit for approval but cannot put anything on the live queue, which is
 * the training path for co-ops and new staff.
 */
import type { Role } from '@/lib/roles';
import { roleAtLeast } from '@/lib/roles';

const PUBLISHING_EMAILS = new Set([
  'matt.karolian@globe.com',
  'matt@boston.com',
]);

function extra(): Set<string> {
  return new Set(
    (process.env.PUBLISHING_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function canUsePublishing(email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase() ?? '';
  return PUBLISHING_EMAILS.has(e) || extra().has(e);
}

export function canApprovePublishing(role: Role): boolean {
  return roleAtLeast(role, 'admin');
}

/**
 * Nothing reaches a real account unless PUBLISHING_LIVE is exactly "true".
 * Otherwise every target uses the mock sender, which records a fake success.
 */
export function publishingLive(): boolean {
  return process.env.PUBLISHING_LIVE === 'true';
}
