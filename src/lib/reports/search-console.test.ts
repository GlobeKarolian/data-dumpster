import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSearchConsoleTables, type SearchConsoleConfig } from './search-console';

const config: SearchConsoleConfig = {
  credentials: {
    kind: 'refresh_token',
    clientId: 'client',
    clientSecret: 'secret',
    refreshToken: 'refresh',
  },
  sites: {
    globeSearch: 'sc-domain:bostonglobe.com',
    bostonSearch: 'sc-domain:boston.com',
  },
};

test('pulls both query tables for the exact report period and formats the dashboard columns', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/token')) return Response.json({ access_token: 'access' });
    return Response.json({
      rows: Array.from({ length: 25 }, (_, index) => ({
        keys: [index === 0 ? (url.includes('boston.com') ? 'boston news' : 'boston globe') : 'query ' + index],
        clicks: 1234 - index, impressions: 5000, ctr: 0.2468, position: 3.456,
      })),
    });
  };

  const tables = await fetchSearchConsoleTables(
    { start: '2026-07-20', end: '2026-07-26' },
    config,
    fetcher as typeof fetch,
  );

  assert.equal(calls.length, 3);
  for (const call of calls.slice(1)) {
    const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>;
    assert.equal(body.startDate, '2026-07-20');
    assert.equal(body.endDate, '2026-07-26');
    assert.equal(body.type, 'web');
    assert.deepEqual(body.dimensions, ['query']);
    assert.equal(body.rowLimit, 25_000);
  }
  assert.deepEqual(tables.globeSearch.rows[0], ['boston globe', '1,234', '5,000', '24.68%', '3.46']);
  assert.deepEqual(tables.bostonSearch.rows[0], ['boston news', '1,234', '5,000', '24.68%', '3.46']);
  assert.equal(tables.globeSearch.rows.length, 25);
  assert.equal(tables.bostonSearch.rows.length, 25);
});

test('rejects a successful-looking response with the wrong row shape', async () => {
  let call = 0;
  const fetcher = async () => {
    call += 1;
    return call === 1 ? Response.json({ access_token: 'access' }) : Response.json({ rows: {} });
  };
  await assert.rejects(
    fetchSearchConsoleTables({ start: '2026-07-20', end: '2026-07-26' }, config, fetcher as typeof fetch),
    /unexpected Search Console response/,
  );
});
