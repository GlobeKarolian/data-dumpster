/**
 * The Boston Herald serves 403 to every automated request for its RSS feed,
 * from every path and user agent. That is a deliberate edge block by the
 * publisher, not a transient failure, so retrying it every run only produces
 * noise in ingestion_runs. Mark the channel inactive and record why.
 *
 * The Herald is still covered through Bluesky, so the company does not go dark.
 */
import { db } from '@/db';
import { channels, companies } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

async function main() {
  const rows = await db
    .select({ id: channels.id, handle: channels.handle, company: companies.name })
    .from(channels)
    .innerJoin(companies, eq(channels.companyId, companies.id))
    .where(and(eq(channels.platform, 'rss'), eq(companies.slug, 'boston-herald')));

  for (const r of rows) {
    await db
      .update(channels)
      .set({
        active: false,
        meta: {
          disabledReason: 'Publisher returns HTTP 403 to all automated feed requests (verified 2026-07-29, all paths and user agents). Covered via Bluesky instead.',
          disabledAt: new Date().toISOString(),
        },
      })
      .where(eq(channels.id, r.id));
    console.log('deactivated', r.company, r.handle);
  }
  if (rows.length === 0) console.log('no Herald RSS channel found');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
