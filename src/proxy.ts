/**
 * Request gate. Decides, before any rendering happens, whether a request is
 * allowed to reach the app.
 *
 * What this is and is not:
 *   - It IS a cheap, uniform "are you signed in" check, so an unauthenticated
 *     browser gets a redirect instead of a rendered shell that then 401s, and
 *     an unauthenticated fetch gets JSON instead of an HTML login page.
 *   - It is NOT the authorization boundary. Tenant and role checks need the
 *     database and belong in lib/session.ts, which every handler calls. If this
 *     file were deleted the app would still be secure, only ruder.
 *
 * It verifies the JWT signature rather than merely looking for a cookie,
 * because a check that any client can satisfy by setting a cookie is theatre.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Paths that must work without a session.
 *
 *  /login          the way in
 *  /about/*        public product, privacy, terms and data-deletion information
 *                  used by customers and platform reviewers
 *  /my-globe/*     public, read-only product concept with no customer data
 *  /invite/*       accepting an invitation, authorized by the token in the path.
 *                  The person holding it has no account yet, so there is nothing
 *                  to authenticate; gating it would make every invitation
 *                  bounce to a sign-in form the invitee cannot pass. The matcher
 *                  below does not exclude it -- it excludes only framework
 *                  internals and paths with a file extension -- so it has to be
 *                  named here.
 *  /request-access public request form for people who do not have accounts yet
 *  /api/access-requests
 *                  submission endpoint for that public form
 *  /api/auth/*     Auth.js itself; gating it would deadlock sign-in
 *  /api/cron/*     called by Vercel Cron with a bearer secret, never a cookie
 *  /api/ingest/worker
 *                  called by the internal refresh dispatcher with the same
 *                  bearer secret; the route performs its own cron check
 *  /api/health     uptime probes have no credentials by design
 *  /share/*        published dashboards, authorized by an unguessable token
 *  /report-share/* published weekly reports, authorized the same way
 *  /api/report-share/*
 *                  post detail for a published weekly report, constrained by
 *                  the same token and saved report snapshot inside the route
 */
const PUBLIC_PREFIXES = [
  '/login', '/request-access', '/about', '/my-globe', '/invite', '/api/access-requests',
  '/api/auth', '/api/cron', '/share', '/report-share',
  '/api/report-share',
] as const;
const PUBLIC_EXACT = ['/api/health', '/api/ingest/worker'] as const;

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname as (typeof PUBLIC_EXACT)[number])) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function isSharedReportPreview(req: NextRequest): boolean {
  return /^\/api\/posts\/[0-9a-f-]+\/preview$/i.test(req.nextUrl.pathname)
    && Boolean(req.nextUrl.searchParams.get('share')?.trim());
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname) || isSharedReportPreview(req)) return NextResponse.next();

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: req.nextUrl.protocol === 'https:',
  });
  if (token?.orgId) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Sign in to continue.', code: 'unauthenticated' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }

  // Round-trip the destination so sign-in lands where the user was headed.
  const login = new URL('/login', req.url);
  login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  /**
   * Skip framework internals and anything with a file extension. Static assets
   * carry no cookies and gating them only slows the app down and breaks the
   * login page's own CSS.
   */
  matcher: ['/((?!_next/|favicon.ico|.*\\..*).*)'],
};
