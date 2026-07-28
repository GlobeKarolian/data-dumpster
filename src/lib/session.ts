/**
 * The authorization boundary.
 *
 * Every server-side entry point in Pressbox -- Server Component or API route --
 * starts here. The reason this is one small module rather than a middleware
 * concern is that the tenant check has to happen where the data is read, not at
 * the edge: a request can be perfectly authenticated and still be asking for
 * another newsroom's landscape.
 *
 * The rule the whole app obeys: an identifier that arrived from a client is a
 * claim, not a fact. assertLandscapeInOrg turns the claim into a fact, or
 * throws. No query function in lib/metrics is called without it.
 */
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { auth, type Role } from '@/auth';
import { db } from '@/db';
import { landscapes } from '@/db/schema';

export type { Role };

/** Least privileged first. Index in this array IS the privilege level. */
export const ROLE_ORDER = ['viewer', 'editor', 'admin', 'owner'] as const;

function rank(role: Role): number {
  return ROLE_ORDER.indexOf(role);
}

/**
 * The one error type the API layer knows how to translate into a status code.
 *
 * It carries a machine-readable code so clients can branch (a viewer hitting a
 * write endpoint deserves a different UI than an expired session), and a message
 * that is safe to show a human. Nothing internal ever ends up in here.
 */
export class AuthError extends Error {
  readonly status: 401 | 403 | 404;
  readonly code: 'unauthenticated' | 'forbidden' | 'not_found';

  constructor(
    code: 'unauthenticated' | 'forbidden' | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = code === 'unauthenticated' ? 401 : code === 'forbidden' ? 403 : 404;
  }
}

/** The identity every handler works from. */
export interface OrgContext {
  orgId: string;
  userId: string;
  role: Role;
}

/**
 * The signed-in session, or a 401.
 *
 * Returns the whole session (name, email, image) for the places that render a
 * user; handlers that only need identity should call requireOrg instead.
 */
export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthError('unauthenticated', 'Sign in to continue.');
  }
  return session;
}

/**
 * Identity narrowed to the three facts that gate data access.
 *
 * A session without an orgId is treated as unauthenticated rather than as a
 * server error: it means the token predates the tenancy claims and the fix is a
 * fresh sign-in.
 */
export async function requireOrg(): Promise<OrgContext> {
  const session = await requireSession();
  const { id, orgId, role } = session.user;
  if (!orgId || !role) {
    throw new AuthError('unauthenticated', 'Your session is out of date. Sign in again.');
  }
  return { orgId, userId: id, role };
}

/**
 * Require at least the given role. Ordering is viewer < editor < admin < owner.
 *
 * Returns the context so call sites can be a single await:
 *   const { orgId } = await requireRole('editor');
 */
export async function requireRole(min: Role): Promise<OrgContext> {
  const ctx = await requireOrg();
  if (rank(ctx.role) < rank(min)) {
    throw new AuthError(
      'forbidden',
      'This action requires the ' + min + ' role or higher. Your role is ' + ctx.role + '.',
    );
  }
  return ctx;
}

/** Non-throwing variant for UI that renders differently per role. */
export function hasRole(role: Role, min: Role): boolean {
  return rank(role) >= rank(min);
}

export interface LandscapeRef {
  id: string;
  name: string;
  slug: string;
  focusCompanyId: string | null;
}

/**
 * Verify that a landscape id supplied by a client belongs to the caller's org.
 *
 * Deliberately answers "not found" rather than "forbidden" for a landscape in
 * another org. Distinguishing the two would confirm the existence of a resource
 * the caller is not allowed to know about, which is how tenant-enumeration bugs
 * start.
 */
export async function assertLandscapeInOrg(
  landscapeId: string,
  orgId: string,
): Promise<LandscapeRef> {
  const [row] = await db
    .select({
      id: landscapes.id,
      name: landscapes.name,
      slug: landscapes.slug,
      focusCompanyId: landscapes.focusCompanyId,
    })
    .from(landscapes)
    .where(and(eq(landscapes.id, landscapeId), eq(landscapes.orgId, orgId)))
    .limit(1);

  if (!row) {
    throw new AuthError('not_found', 'That landscape does not exist.');
  }
  return row;
}

/* ------------------------------------------------------------- API wrapper */

/** The error body every failing endpoint returns. Stable, and free of internals. */
export interface ApiErrorBody {
  error: string;
  code: string;
  /** Present only for validation failures: which field, and what was wrong. */
  fields?: { path: string; message: string }[];
}

/** Distinguishable from Zod and Auth errors so handlers can raise a plain 4xx. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'bad_request',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function errorResponse(body: ApiErrorBody, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

/**
 * Wrap a route handler so failures become correct, safe HTTP responses.
 *
 * Three classes of failure, three treatments:
 *   AuthError -> 401/403/404 with its own message, which is already user-facing.
 *   ZodError  -> 400 with per-field detail, because a client that sent a bad
 *                query deserves to be told which parameter and why.
 *   anything else -> 500 with a fixed string. The real error is logged server
 *                side with a correlation id the caller can quote to support.
 *                Postgres errors in particular leak table and column names and
 *                must never reach a response body.
 *
 * Two overloads: the second is for dynamic segments, where Next 16 hands the
 * handler a context whose params are a Promise that must be awaited.
 */
export function apiHandler(
  fn: (req: NextRequest) => Promise<Response>,
): (req: NextRequest) => Promise<Response>;
export function apiHandler<P>(
  fn: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;
export function apiHandler<P>(
  fn: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse({ error: err.message, code: err.code }, err.status);
      }
      if (err instanceof ZodError) {
        return errorResponse(
          {
            error: 'The request could not be validated.',
            code: 'invalid_request',
            fields: err.issues.map((issue) => ({
              path: issue.path.map(String).join('.') || '(root)',
              message: issue.message,
            })),
          },
          400,
        );
      }
      if (err instanceof HttpError) {
        return errorResponse({ error: err.message, code: err.code }, err.status);
      }

      // Correlate the opaque response with the detailed server-side log.
      const ref = Math.random().toString(36).slice(2, 10);
      console.error('[pressbox:api] ' + ref + ' ' + req.method + ' ' + req.nextUrl.pathname, err);
      return errorResponse(
        {
          error: 'Something went wrong on our end. Reference ' + ref + '.',
          code: 'internal_error',
        },
        500,
      );
    }
  };
}
