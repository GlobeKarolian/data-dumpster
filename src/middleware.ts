/**
 * Edge gate. Decides, before any rendering happens, whether a request is even
 * allowed to reach the app.
 *
 * What this is and is not:
 *   - It IS a cheap, uniform "are you signed in" check, so an unauthenticated
 *     browser gets a redirect instead of a rendered shell that then 401s, and an
 *     unauthenticated fetch gets JSON instead of an HTML login page.
 *   - It is NOT the authorization boundary. Tenant and role checks need the
 *     database and belong in lib/session.ts, which every handler calls. If this
 *     file were deleted the app would still be secure, only ruder.
 *
 * It verifies the JWT signature rather than merely looking for a cookie, because
 * a check that any client can satisfy by setting a cookie is theatre.
 *
 * Note on naming: Next 16 renames this convention to "proxy.ts" and deprecates
 * "middleware.ts". Migrating is a two-token change -- rename the file and rename
 * the exported function to "proxy" -- and nothing else here has to move.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Paths that must work without a session.
 *
 *  /login          the way in
 *  /invite/*       accepting an invitation, authorized by the token in the path.
 *                  The person holding it has no account yet, so there is nothing
 *                  to authenticate; gating it would make every invitation
 *                  bounce to a sign-in form the invitee cannot pass. The matcher
 *                  below does not exclude it -- it excludes only framework
 *                  internals and paths with a file extension -- so it has to be
 *                  named here.
 *  /api/auth/*     Auth.js itself; gating it would deadlock sign-in
 *  /api/cron/*     called by Vercel Cron with a bearer secret, never a cookie
 *  /api/health     uptime probes have no credentials by design
 *  /share/*        published dashboards, authorized by an unguessable token
 */
const PUBLIC_PREFIXES = ['/login', '/invite', '/api/auth', '/api/cron', '/share'] as const;
const PUBLIC_EXACT = ['/api/health'] as const;

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname as (typeof PUBLIC_EXACT)[number])) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

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
