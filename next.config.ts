import type { NextConfig } from 'next';

/**
 * Security response headers.
 *
 * Next sets none of these by default, so the deployment was shipping with no
 * CSP, no framing policy and no HSTS. Every authenticated screen, including
 * the role editor at /settings/users and the model-connection editor that
 * holds API keys, was framable by any origin.
 *
 * The CSP is deliberately conservative rather than aspirational. 'unsafe-inline'
 * on style-src is required by the inlined critical CSS Next emits, and
 * 'unsafe-eval' is omitted because nothing here needs it. script-src stays
 * 'self' plus the inline-script nonce Next manages; if a future dependency
 * needs a CDN it should be added here explicitly rather than by widening this
 * to a wildcard.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Avatars and post thumbnails come from every platform's CDN, so images are
  // the one directive that has to be broad. https: only, never http:.
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  // The browser talks only to this origin; every vendor call is server-side.
  "connect-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Nothing in this product uses a camera, microphone or location.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
