import { createSign } from 'node:crypto';
import { SEARCH_QUERY_LIMIT, type ManualTable, type Period } from './types';
import { rowsToTsv } from './tsv';
import type { SearchTableId } from './search-console-sources';

const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const SEARCH_ANALYTICS_URL = 'https://www.googleapis.com/webmasters/v3/sites';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';

type RefreshTokenCredentials = {
  kind: 'refresh_token';
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type ServiceAccountCredentials = {
  kind: 'service_account';
  clientEmail: string;
  privateKey: string;
  tokenUrl: string;
};

type SearchConsoleCredentials = RefreshTokenCredentials | ServiceAccountCredentials;

export type SearchConsoleConfig = {
  credentials: SearchConsoleCredentials;
  sites: Record<SearchTableId, string>;
};

type SearchAnalyticsRow = {
  keys?: unknown;
  clicks?: unknown;
  impressions?: unknown;
  ctr?: unknown;
  position?: unknown;
};

export class SearchConsoleError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'authentication_failed' | 'query_failed' | 'invalid_response',
  ) {
    super(message);
    this.name = 'SearchConsoleError';
  }
}

function requiredEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function parseServiceAccount(raw: string): ServiceAccountCredentials {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new SearchConsoleError(
      'The Google Search Console service-account JSON is not valid JSON.',
      'not_configured',
    );
  }
  if (typeof value !== 'object' || value === null) {
    throw new SearchConsoleError(
      'The Google Search Console service-account credential is incomplete.',
      'not_configured',
    );
  }
  const record = value as Record<string, unknown>;
  const clientEmail = typeof record.client_email === 'string' ? record.client_email.trim() : '';
  const privateKey = typeof record.private_key === 'string' ? record.private_key : '';
  const tokenUrl = typeof record.token_uri === 'string' && record.token_uri.trim()
    ? record.token_uri.trim()
    : DEFAULT_TOKEN_URL;
  if (!clientEmail || !privateKey) {
    throw new SearchConsoleError(
      'The Google Search Console service-account credential needs client_email and private_key.',
      'not_configured',
    );
  }
  return { kind: 'service_account', clientEmail, privateKey, tokenUrl };
}

/** Read deployment credentials without ever returning their values to the client. */
export function searchConsoleConfigFromEnv(): SearchConsoleConfig {
  const globeSite = requiredEnv('GOOGLE_SEARCH_CONSOLE_GLOBE_SITE');
  const bostonSite = requiredEnv('GOOGLE_SEARCH_CONSOLE_BOSTON_SITE');
  if (!globeSite || !bostonSite) {
    throw new SearchConsoleError(
      'Search Console needs both the Globe.com and Boston.com property identifiers.',
      'not_configured',
    );
  }

  const serviceAccount = requiredEnv('GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON');
  let credentials: SearchConsoleCredentials;
  if (serviceAccount) {
    credentials = parseServiceAccount(serviceAccount);
  } else {
    const clientId = requiredEnv('GOOGLE_SEARCH_CONSOLE_CLIENT_ID');
    const clientSecret = requiredEnv('GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET');
    const refreshToken = requiredEnv('GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN');
    if (!clientId || !clientSecret || !refreshToken) {
      throw new SearchConsoleError(
        'Search Console is not connected. Add a service account, or an OAuth client and refresh token.',
        'not_configured',
      );
    }
    credentials = { kind: 'refresh_token', clientId, clientSecret, refreshToken };
  }

  return {
    credentials,
    sites: { globeSearch: globeSite, bostonSearch: bostonSite },
  };
}

export function isSearchConsoleConfigured(): boolean {
  try {
    searchConsoleConfigFromEnv();
    return true;
  } catch {
    return false;
  }
}

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null);
  return typeof payload === 'object' && payload !== null
    ? payload as Record<string, unknown>
    : {};
}

async function accessToken(
  credentials: SearchConsoleCredentials,
  fetcher: typeof fetch,
): Promise<string> {
  let tokenUrl = DEFAULT_TOKEN_URL;
  let body: URLSearchParams;
  if (credentials.kind === 'refresh_token') {
    body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    });
  } else {
    tokenUrl = credentials.tokenUrl;
    const now = Math.floor(Date.now() / 1_000);
    const unsigned = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.'
      + base64Url(JSON.stringify({
        iss: credentials.clientEmail,
        scope: SEARCH_CONSOLE_SCOPE,
        aud: tokenUrl,
        iat: now,
        exp: now + 3_600,
      }));
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const assertion = unsigned + '.' + signer.sign(credentials.privateKey).toString('base64url');
    body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });
  }

  const response = await fetcher(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  const payload = await readJsonResponse(response);
  if (!response.ok || typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new SearchConsoleError(
      'Google rejected the Search Console connection. Reconnect the credential and try again.',
      'authentication_failed',
    );
  }
  return payload.access_token;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function tableFromRows(rows: SearchAnalyticsRow[]): ManualTable {
  const values = rows.map((row) => {
    const query = Array.isArray(row.keys) && typeof row.keys[0] === 'string' ? row.keys[0] : null;
    const clicks = finiteNumber(row.clicks);
    const impressions = finiteNumber(row.impressions);
    const ctr = finiteNumber(row.ctr);
    const position = finiteNumber(row.position);
    if (query === null || clicks === null || impressions === null || ctr === null) return null;
    return [
      query,
      integer.format(clicks),
      integer.format(impressions),
      (ctr * 100).toFixed(2) + '%',
      position === null ? '' : position.toFixed(2),
    ];
  }).filter((row): row is string[] => row !== null);

  const updatedAt = new Date().toISOString();
  return { raw: rowsToTsv(values), rows: values, updatedAt };
}

async function querySite(
  siteUrl: string,
  period: Period,
  token: string,
  fetcher: typeof fetch,
): Promise<ManualTable> {
  const response = await fetcher(
    SEARCH_ANALYTICS_URL + '/' + encodeURIComponent(siteUrl) + '/searchAnalytics/query',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        startDate: period.start,
        endDate: period.end,
        dimensions: ['query'],
        type: 'web',
        aggregationType: 'byProperty',
        // Google orders Search Analytics query rows by clicks descending. The
        // leadership report deliberately stops at twenty so both properties
        // remain scannable rather than turning into data dumps of their own.
        rowLimit: SEARCH_QUERY_LIMIT,
        dataState: 'final',
      }),
      cache: 'no-store',
    },
  );
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new SearchConsoleError(
      'Google could not read one of the Search Console properties for this report period.',
      'query_failed',
    );
  }
  if (payload.rows !== undefined && !Array.isArray(payload.rows)) {
    throw new SearchConsoleError('Google returned an unexpected Search Console response.', 'invalid_response');
  }
  return tableFromRows(((payload.rows ?? []) as SearchAnalyticsRow[]).slice(0, SEARCH_QUERY_LIMIT));
}

/** Pull the two Web Search tables with one short-lived Google access token. */
export async function fetchSearchConsoleTables(
  period: Period,
  config: SearchConsoleConfig,
  fetcher: typeof fetch = fetch,
): Promise<Record<SearchTableId, ManualTable>> {
  const token = await accessToken(config.credentials, fetcher);
  const [globeSearch, bostonSearch] = await Promise.all([
    querySite(config.sites.globeSearch, period, token, fetcher),
    querySite(config.sites.bostonSearch, period, token, fetcher),
  ]);
  return { globeSearch, bostonSearch };
}

export async function pullSearchConsoleTables(period: Period): Promise<Record<SearchTableId, ManualTable>> {
  return fetchSearchConsoleTables(period, searchConsoleConfigFromEnv());
}
