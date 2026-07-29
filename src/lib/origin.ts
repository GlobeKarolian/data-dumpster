/**
 * Where this deployment actually lives, as an absolute origin.
 *
 * An invitation link is useless if it points at the wrong host, and it is the
 * only way the invited person gets in, so the resolution order matters:
 *
 *  1. AUTH_URL, which Auth.js already requires behind a proxy and which is
 *     therefore the value an operator has most likely got right.
 *  2. The forwarded host and protocol, which Vercel and most reverse proxies
 *     set correctly.
 *  3. The request URL, which is right in development and on a bare deployment.
 *
 * Nothing here trusts an origin from a request body. A Host header can be
 * spoofed, but a spoofed Host only ever produces a broken link for the person
 * who spoofed it, whereas an origin read from a body would let an administrator
 * mint invitation links pointing anywhere at all.
 */
import type { NextRequest } from 'next/server';

function fromEnv(): string | null {
  const configured =
    process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

/** For Server Components, which get headers() rather than a request object. */
export function originFromHeaders(headerList: Headers, fallback = 'http://localhost:3000'): string {
  const configured = fromEnv();
  if (configured) return configured;

  const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
  if (!host) return fallback;

  const forwardedProto = headerList.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto ?? (host.startsWith('localhost') ? 'http' : 'https');
  return proto + '://' + host;
}

/** For route handlers. */
export function absoluteOrigin(req: NextRequest): string {
  const configured = fromEnv();
  if (configured) return configured;

  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) {
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    return (forwardedProto ?? req.nextUrl.protocol.replace(':', '')) + '://' + host;
  }

  return req.nextUrl.origin;
}
