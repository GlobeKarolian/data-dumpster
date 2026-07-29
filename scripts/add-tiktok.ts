/**
 * Add TikTok channels for the Boston news landscape.
 *
 * Every channel is created with is_owned = false, which routes it through the
 * purchased Bright Data path rather than the TikTok Display API. Handles that
 * do not exist will fail loudly on first ingest and can be deactivated then;
 * guessing and silently storing a dead handle would be worse than a visible
 * error, because a missing competitor reads as a competitor with no activity.
 */
import { db } from '@/db';
import { companies, channels, landscapes, landscapeCompanies } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { slugify } from '@/lib/utils';

/** Existing companies get a TikTok channel. New ones are created first. */
const EXISTING: Record<string, string> = {
  'the-boston-globe': 'bostonglobe',
  'boston-com': 'boston.com',
  'stat-news': 'statnews',
  'boston-herald': 'bostonherald',
  wbur: 'wbur',
  'gbh-news': 'gbhnews',
};

/** Competitors visible in the incumbent tool's landscape but missing from ours. */
const NEW_COMPANIES: { name: string; tiktok: string; segment: string }[] = [
  { name: 'NBC10 Boston', tiktok: 'nbc10boston', segment: 'local television' },
  { name: 'NESN', tiktok: 'nesn', segment: 'regional sports network' },
  { name: 'Boston 25 News', tiktok: 'boston25news', segment: 'local television' },
  { name: 'MassLive', tiktok: 'masslive', segment: 'digital news' },
  { name: 'Boston Magazine', tiktok: 'bostonmagazine', segment: 'city magazine' },
  { name: 'The B-Side', tiktok: 'bsidebos', segment: 'newsletter brand' },
];

async function main() {
  const [org] = await db.select().from(companies).limit(1);
  if (!org) throw new Error('No companies found. Run the seed first.');
  const orgId = org.orgId;

  const [landscape] = await db.select().from(landscapes)
    .where(and(eq(landscapes.orgId, orgId), eq(landscapes.slug, 'boston-news-landscape')));

  let added = 0;
  let created = 0;

  async function attachTikTok(companyId: string, handle: string, label: string) {
    const existing = await db.select().from(channels)
      .where(and(eq(channels.companyId, companyId), eq(channels.platform, 'tiktok')));
    if (existing.length > 0) { console.log('  exists  ', label, '@' + handle); return; }

    await db.insert(channels).values({
      companyId,
      platform: 'tiktok',
      handle,
      profileUrl: 'https://www.tiktok.com/@' + handle,
      isOwned: false,
      active: true,
      meta: { source: 'brightdata', addedBy: 'add-tiktok script' },
    });
    added += 1;
    console.log('  added   ', label, '@' + handle);
  }

  console.log('\nTikTok channels for existing companies');
  for (const [slug, handle] of Object.entries(EXISTING)) {
    const [c] = await db.select().from(companies)
      .where(and(eq(companies.orgId, orgId), eq(companies.slug, slug)));
    if (!c) { console.log('  missing  company', slug); continue; }
    await attachTikTok(c.id, handle, c.name);
  }

  console.log('\nNew competitors');
  for (const spec of NEW_COMPANIES) {
    const slug = slugify(spec.name);
    let [c] = await db.select().from(companies)
      .where(and(eq(companies.orgId, orgId), eq(companies.slug, slug)));

    if (!c) {
      [c] = await db.insert(companies)
        .values({ orgId, name: spec.name, slug, segment: spec.segment })
        .returning();
      created += 1;
      console.log('  created company', spec.name);
    }

    await attachTikTok(c.id, spec.tiktok, spec.name);

    if (landscape) {
      const member = await db.select().from(landscapeCompanies)
        .where(and(
          eq(landscapeCompanies.landscapeId, landscape.id),
          eq(landscapeCompanies.companyId, c.id),
        ));
      if (member.length === 0) {
        await db.insert(landscapeCompanies)
          .values({ landscapeId: landscape.id, companyId: c.id, sortOrder: 50 });
        console.log('  joined landscape', spec.name);
      }
    }
  }

  console.log('\n' + created + ' companies created, ' + added + ' TikTok channels added.');
  console.log('All TikTok channels are competitor reads served by Bright Data.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
