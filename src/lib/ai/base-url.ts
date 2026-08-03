/**
 * Validating the endpoint a model connection is allowed to talk to.
 *
 * `baseUrl` exists so an org can point Data Dumpster at Ollama on a laptop or
 * at an internal gateway. That flexibility is also the most dangerous field in
 * the product, because every provider sends the org's decrypted API key to
 * whatever host it names, and the response body comes back to the caller.
 *
 * Two concrete attacks it has to stop.
 *
 * Credential theft: the API key is deliberately write-only everywhere else in
 * the app, masked on read and never returned in full. Repointing baseUrl at an
 * attacker-controlled host and pressing Test delivers that key to them as an
 * Authorization header, without needing to know it. `apiKey` is sticky on
 * PATCH, so this works while supplying no credential at all.
 *
 * SSRF: provider errors surface the first 400 bytes of the response body to
 * the caller and persist it to `lastCheckError`, which a viewer can read. A
 * baseUrl of http://169.254.169.254/ turns that into a cloud-metadata reader.
 *
 * The defence is a scheme and address allowlist, applied at write time. DNS is
 * deliberately NOT resolved here: a name that resolves publicly at save time
 * and privately at request time (DNS rebinding) would pass anyway, so this
 * blocks the literal-address cases and the outbound fetch stays the boundary
 * of record.
 */

/** Reserved IPv4 ranges, as prefixes on the dotted-quad string. */
function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;          // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true;                         // multicast and reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique local
  if (h.startsWith('fe80')) return true;                     // link-local

  /*
   * IPv4-mapped addresses, in both spellings.
   *
   * WHATWG URL parsing rewrites ::ffff:169.254.169.254 into ::ffff:a9fe:a9fe,
   * so checking only the dotted form let the canonical metadata address through
   * as a valid https host. Both are decoded back to IPv4 and re-checked.
   */
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (dotted) return isPrivateIpv4(dotted[1]);

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    const quad = [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
    return isPrivateIpv4(quad);
  }
  return false;
}

const LOCAL_NAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata', 'metadata.google.internal', 'instance-data',
]);

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Loopback is allowed only when the server itself is a developer's machine.
 *
 * Ollama on localhost is a real, supported setup, and on a laptop the server
 * and the model are the same host. In a deployed environment they are not:
 * "localhost" there means the production server's own network namespace, which
 * is never something a tenant should be able to aim at.
 */
function loopbackAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function checkBaseUrl(
  raw: string | null | undefined,
  /** Overridable so the production branch is testable without mutating env. */
  opts: { allowLoopback?: boolean } = {},
): BaseUrlCheck {
  const allowLoopback = opts.allowLoopback ?? loopbackAllowed();
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { ok: true, url: '' };
  }
  const value = raw.trim();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'That is not a valid absolute URL.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      reason: `Only http and https endpoints are supported, not "${url.protocol}".`,
    };
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'Credentials embedded in the URL are not accepted.' };
  }

  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || host === '[::1]';

  if (loopback) {
    return allowLoopback
      ? { ok: true, url: value }
      : {
        ok: false,
        reason: 'A loopback address points at the Data Dumpster server itself, not at your '
          + 'machine. Expose the model on a reachable hostname instead.',
      };
  }

  if (LOCAL_NAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: `"${url.hostname}" is an internal address and is not reachable.` };
  }

  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return {
      ok: false,
      reason: `"${url.hostname}" is a private or link-local address. The server would be asked `
        + 'to send your API key there, so it is refused.',
    };
  }

  if (url.protocol === 'http:') {
    return {
      ok: false,
      reason: 'Plain http would send your API key unencrypted. Use https.',
    };
  }

  return { ok: true, url: value };
}
