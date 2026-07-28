/**
 * Shared authorization for the scheduled endpoints.
 *
 * Vercel Cron calls these over the public internet with a bearer token, so the
 * check has to be real:
 *
 *  - Both sides are hashed to a fixed 32 bytes before comparison. timingSafeEqual
 *    throws on a length mismatch, which would itself leak the secret's length;
 *    hashing first makes every comparison the same shape.
 *  - The comparison is constant time. A naive === on a secret compared over the
 *    network is a byte-at-a-time oracle, and these endpoints trigger paid API
 *    calls and write to the database.
 *  - A missing CRON_SECRET fails closed. An unset environment variable must never
 *    mean "let everyone in".
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { AuthError } from '@/lib/session';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Accepts the secret in the Authorization header (what Vercel Cron sends) or in
 * an x-cron-secret header, which is easier to curl during an incident.
 */
export function assertCronAuthorized(req: NextRequest): void {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    throw new AuthError('forbidden', 'Scheduled jobs are disabled: CRON_SECRET is not configured.');
  }

  const header = req.headers.get('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const presented = bearer || req.headers.get('x-cron-secret') || '';

  if (!presented || !timingSafeEqual(digest(presented), digest(expected))) {
    throw new AuthError('unauthenticated', 'Invalid cron credentials.');
  }
}

/** Cron responses are always JSON and never cached anywhere. */
export function cronJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * Vercel Cron issues GET; a human debugging an incident reaches for POST or
 * vice versa. Both are accepted everywhere so nobody has to remember which.
 */
export type CronResult = Record<string, unknown>;
