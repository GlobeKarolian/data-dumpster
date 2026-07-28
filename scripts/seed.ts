/**
 * Seed Pressbox with a real Boston media landscape.
 *
 * Two rules govern everything in this file.
 *
 * **It is idempotent.** Every write is an upsert against a unique index, so
 * running it twice changes nothing and running it against a live database is
 * safe. A seed you are afraid to re-run is a seed nobody runs.
 *
 * **It does not invent a single metric.** No follower counts, no engagement, no
 * posts. Every number in Pressbox comes from ingestion, and a seeded number that
 * looks real is a number someone will eventually put in a deck. What this script
 * creates is the *shape* of the workspace -- who we watch, on which channels,
 * grouped how -- and then gets out of the way.
 *
 * The handles below are the real public accounts, verified against the platforms
 * at the time of writing. Channels on platforms Pressbox cannot read yet
 * (Instagram, X) are still recorded, but marked inactive so the ingest runner
 * skips them instead of failing on them every three hours. They are there
 * because the day an adapter exists, the handles should not have to be re-typed.
 */
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import {
  channels, companies, landscapeCompanies, landscapes, orgs, postTags, users,
} from '../src/db/schema';
import type { Platform } from '../src/lib/types';

/* --------------------------------------------------------------- the data */

const ORG = { name: 'Boston Globe Media', slug: 'boston-globe-media' };

interface SeedChannel {
  platform: Platform;
  /** Handle, profile URL, or feed URL, in whatever form the adapter parses. */
  handle: string;
  profileUrl?: string;
  /**
   * False for platforms with no adapter. The row is a record of the account,
   * not a promise that we can read it. See lib/adapters/registry.ts for why
   * Instagram and X cannot be read for accounts you do not own.
   */
  active?: boolean;
}

interface SeedCompany {
  name: string;
  slug: string;
  website: string;
  segment: string;
  color: string;
  channels: SeedChannel[];
}

const COMPANIES: SeedCompany[] = [
  {
    name: 'The Boston Globe',
    slug: 'boston-globe',
    website: 'https://www.bostonglobe.com',
    segment: 'metro daily',
    color: '#C8102E',
    channels: [
      { platform: 'bluesky', handle: 'bostonglobe.com' },
      { platform: 'youtube', handle: '@bostonglobe' },
      { platform: 'rss', handle: 'https://www.bostonglobe.com/arc/outboundfeeds/rss/?outputType=xml' },
      { platform: 'instagram', handle: 'bostonglobe', profileUrl: 'https://www.instagram.com/bostonglobe/', active: false },
      { platform: 'twitter', handle: 'BostonGlobe', profileUrl: 'https://x.com/BostonGlobe', active: false },
    ],
  },
  {
    name: 'Boston.com',
    slug: 'boston-com',
    website: 'https://www.boston.com',
    segment: 'digital lifestyle',
    color: '#0B7285',
    channels: [
      { platform: 'bluesky', handle: 'boston.com' },
      { platform: 'youtube', handle: '@boston' },
      { platform: 'rss', handle: 'https://www.boston.com/feed/' },
      { platform: 'instagram', handle: 'boston_com', profileUrl: 'https://www.instagram.com/boston_com/', active: false },
    ],
  },
  {
    name: 'STAT News',
    slug: 'stat-news',
    website: 'https://www.statnews.com',
    segment: 'vertical trade',
    color: '#7048E8',
    channels: [
      { platform: 'bluesky', handle: 'statnews.com' },
      { platform: 'youtube', handle: '@statnews' },
      { platform: 'rss', handle: 'https://www.statnews.com/feed/' },
      { platform: 'instagram', handle: 'statnews', profileUrl: 'https://www.instagram.com/statnews/', active: false },
    ],
  },
  {
    name: 'Boston Herald',
    slug: 'boston-herald',
    website: 'https://www.bostonherald.com',
    segment: 'metro daily',
    color: '#1864AB',
    channels: [
      { platform: 'bluesky', handle: 'bostonherald.com' },
      { platform: 'youtube', handle: '@bostonherald' },
      { platform: 'rss', handle: 'https://www.bostonherald.com/feed/' },
      { platform: 'twitter', handle: 'bostonherald', profileUrl: 'https://x.com/bostonherald', active: false },
    ],
  },
  {
    name: 'WBUR',
    slug: 'wbur',
    website: 'https://www.wbur.org',
    segment: 'public radio',
    color: '#E8590C',
    channels: [
      { platform: 'bluesky', handle: 'wbur.org' },
      { platform: 'youtube', handle: '@wbur' },
      { platform: 'rss', handle: 'https://www.wbur.org/feed' },
      { platform: 'instagram', handle: 'wbur', profileUrl: 'https://www.instagram.com/wbur/', active: false },
    ],
  },
  {
    name: 'GBH News',
    slug: 'gbh-news',
    website: 'https://www.gbh.org/news',
    segment: 'public radio',
    color: '#2B8A3E',
    channels: [
      // gbh.org does not serve a Bluesky handle at the domain; the account is on
      // the default bsky.social namespace.
      { platform: 'bluesky', handle: 'gbhnews.bsky.social' },
      { platform: 'youtube', handle: '@gbhnews' },
      { platform: 'instagram', handle: 'gbhnews', profileUrl: 'https://www.instagram.com/gbhnews/', active: false },
    ],
  },
  {
    name: 'Axios Boston',
    slug: 'axios-boston',
    website: 'https://www.axios.com/local/boston',
    segment: 'newsletter native',
    color: '#111827',
    channels: [
      // Axios Boston publishes through a newsletter and the national accounts;
      // there is no Boston-specific feed or Bluesky handle to point at. Recorded
      // inactive rather than pointed at national Axios, which would attribute
      // national numbers to a local edition.
      { platform: 'instagram', handle: 'axiosboston', profileUrl: 'https://www.instagram.com/axiosboston/', active: false },
      { platform: 'twitter', handle: 'axiosboston', profileUrl: 'https://x.com/axiosboston', active: false },
    ],
  },
  {
    name: 'The Boston Globe Sports',
    slug: 'boston-globe-sports',
    website: 'https://www.bostonglobe.com/sports',
    segment: 'desk vertical',
    color: '#F08C00',
    channels: [
      { platform: 'instagram', handle: 'globesports', profileUrl: 'https://www.instagram.com/globesports/', active: false },
      { platform: 'twitter', handle: 'BGlobeSports', profileUrl: 'https://x.com/BGlobeSports', active: false },
    ],
  },
];

const LANDSCAPES = [
  {
    name: 'Boston News Landscape',
    slug: 'boston-news-landscape',
    description: 'How the Globe compares to the outlets it competes with for Boston attention.',
    focusSlug: 'boston-globe',
    memberSlugs: [
      'boston-globe', 'boston-herald', 'wbur', 'gbh-news', 'axios-boston', 'boston-com',
    ],
  },
  {
    name: 'Globe Owned Brands',
    slug: 'globe-owned-brands',
    description: 'The Boston Globe Media portfolio measured against itself.',
    focusSlug: 'boston-globe',
    memberSlugs: ['boston-globe', 'boston-com', 'stat-news', 'boston-globe-sports'],
  },
];

/**
 * Starter tags, each with a rule that actually matches something.
 *
 * A tag with no rule is a tag nobody applies, and an empty Post Tags screen on
 * day one reads as a broken feature rather than an unconfigured one. These are
 * deliberately keyword-and-path based rather than AI-based so they cost nothing
 * to run and produce identical results every time -- the AI tagger is for the
 * nuance these miss, not for the obvious cases.
 *
 * urlPathContains does most of the real work: a newsroom's own CMS already
 * classified the story, and the section is right there in the URL.
 */
const TAGS = [
  {
    name: 'Sports',
    color: '#F08C00',
    rule: {
      anyKeywords: ['red sox', 'celtics', 'bruins', 'patriots', 'revolution', 'fenway',
        'td garden', 'gillette stadium', 'nfl', 'nba', 'mlb', 'nhl'],
      hashtags: ['redsox', 'celtics', 'bruins', 'patriots', 'dirtywater'],
      urlPathContains: ['/sports/'],
    },
  },
  {
    name: 'Politics',
    color: '#1864AB',
    rule: {
      anyKeywords: ['beacon hill', 'state house', 'city council', 'mayor', 'governor',
        'legislature', 'election', 'ballot', 'campaign', 'congress', 'senate'],
      urlPathContains: ['/politics/', '/metro/politics/'],
    },
  },
  {
    name: 'Breaking News',
    color: '#C8102E',
    rule: {
      anyKeywords: ['breaking', 'developing', 'just in', 'live updates', 'we are following'],
      hashtags: ['breaking', 'breakingnews'],
    },
  },
  {
    name: 'Weather',
    color: '#0B7285',
    rule: {
      anyKeywords: ['forecast', 'snowstorm', 'nor easter', 'blizzard', 'heat advisory',
        'flood warning', 'hurricane', 'wind chill', 'inches of snow'],
      hashtags: ['mawx', 'bosnow'],
      urlPathContains: ['/weather/'],
    },
  },
  {
    name: 'Food & Dining',
    color: '#E8590C',
    rule: {
      anyKeywords: ['restaurant', 'chef', 'menu', 'dining', 'brunch', 'cocktail',
        'bakery', 'tasting menu', 'now open'],
      urlPathContains: ['/food/', '/dining/'],
    },
  },
  {
    name: 'Arts & Culture',
    color: '#7048E8',
    rule: {
      anyKeywords: ['museum', 'exhibit', 'concert', 'album', 'theater', 'theatre',
        'film festival', 'gallery', 'symphony', 'review'],
      urlPathContains: ['/arts/', '/entertainment/'],
    },
  },
  {
    name: 'Opinion',
    color: '#495057',
    rule: {
      anyKeywords: ['opinion', 'editorial', 'op-ed', 'commentary', 'perspective'],
      urlPathContains: ['/opinion/', '/ideas/'],
    },
  },
  {
    name: 'Business',
    color: '#2B8A3E',
    rule: {
      anyKeywords: ['earnings', 'layoffs', 'startup', 'venture', 'biotech', 'ipo',
        'housing market', 'unemployment', 'acquisition', 'economy'],
      urlPathContains: ['/business/'],
    },
  },
];

/* ------------------------------------------------------------------ output */

const notes: string[] = [];

function step(message: string): void {
  console.log('  ' + message);
}

/* -------------------------------------------------------------- the seeding */

async function seedOrg(): Promise<string> {
  const [row] = await db
    .insert(orgs)
    .values({ name: ORG.name, slug: ORG.slug })
    .onConflictDoUpdate({ target: orgs.slug, set: { name: ORG.name } })
    .returning({ id: orgs.id });
  step('org ' + ORG.name + ' (' + ORG.slug + ')');
  return row.id;
}

/**
 * The admin user.
 *
 * An existing user's password is never overwritten unless SEED_ADMIN_PASSWORD
 * was explicitly supplied. Re-running the seed after months of use must not
 * silently reset the account someone is signed in with.
 */
async function seedAdmin(orgId: string): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@bostonglobemedia.com').trim().toLowerCase();
  const supplied = process.env.SEED_ADMIN_PASSWORD?.trim();
  const generated = supplied ? null : randomBytes(15).toString('base64url');
  const password = supplied ?? generated;
  if (!password) throw new Error('Unable to determine a seed password.');

  const [existing] = await db
    .select({ id: users.id, hasPassword: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const shouldWritePassword = !existing || !existing.hasPassword || Boolean(supplied);
  const passwordHash = shouldWritePassword ? await hash(password, 12) : null;

  await db
    .insert(users)
    .values({ orgId, email, name: 'Pressbox Admin', role: 'owner', passwordHash })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        orgId,
        role: 'owner',
        ...(passwordHash ? { passwordHash } : {}),
      },
    });

  step('owner ' + email);
  if (generated && shouldWritePassword) {
    notes.push(
      'Generated a password for ' + email + ': ' + password + '\n'
      + '    This is printed exactly once. Save it now, or set SEED_ADMIN_PASSWORD and re-run.',
    );
  } else if (!shouldWritePassword) {
    notes.push('Left the existing password for ' + email + ' untouched.');
  }
}

async function seedCompanies(orgId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const company of COMPANIES) {
    const [row] = await db
      .insert(companies)
      .values({
        orgId,
        name: company.name,
        slug: company.slug,
        website: company.website,
        segment: company.segment,
        color: company.color,
      })
      .onConflictDoUpdate({
        target: [companies.orgId, companies.slug],
        set: {
          name: company.name,
          website: company.website,
          segment: company.segment,
          color: company.color,
        },
      })
      .returning({ id: companies.id });

    ids.set(company.slug, row.id);

    for (const channel of company.channels) {
      await db
        .insert(channels)
        .values({
          companyId: row.id,
          platform: channel.platform,
          handle: channel.handle,
          profileUrl: channel.profileUrl ?? null,
          active: channel.active ?? true,
        })
        .onConflictDoUpdate({
          target: [channels.companyId, channels.platform, channels.handle],
          set: { profileUrl: channel.profileUrl ?? null, active: channel.active ?? true },
        });
    }

    const readable = company.channels.filter((c) => c.active !== false).length;
    step(company.name + ' - ' + company.channels.length + ' channels, ' + readable + ' readable');
    if (readable === 0) {
      notes.push(
        company.name + ' has no readable channel yet. Its rows will be empty until an '
        + 'adapter exists for Instagram or X, or until someone adds a feed for it.',
      );
    }
  }

  return ids;
}

async function seedLandscapes(orgId: string, companyIds: Map<string, string>): Promise<void> {
  for (const landscape of LANDSCAPES) {
    const focusCompanyId = companyIds.get(landscape.focusSlug) ?? null;

    const [row] = await db
      .insert(landscapes)
      .values({
        orgId,
        name: landscape.name,
        slug: landscape.slug,
        description: landscape.description,
        focusCompanyId,
      })
      .onConflictDoUpdate({
        target: [landscapes.orgId, landscapes.slug],
        set: { name: landscape.name, description: landscape.description, focusCompanyId },
      })
      .returning({ id: landscapes.id });

    const memberIds = landscape.memberSlugs
      .map((slug) => companyIds.get(slug))
      .filter((id): id is string => id !== undefined);

    // Membership is replaced rather than merged so the seed file stays the
    // source of truth for what a seeded landscape contains.
    await db.delete(landscapeCompanies).where(eq(landscapeCompanies.landscapeId, row.id));
    if (memberIds.length > 0) {
      await db.insert(landscapeCompanies).values(
        memberIds.map((companyId, i) => ({ landscapeId: row.id, companyId, sortOrder: i })),
      );
    }

    step(landscape.name + ' - focus ' + landscape.focusSlug + ', ' + memberIds.length + ' companies');
  }
}

async function seedTags(orgId: string): Promise<void> {
  for (const tag of TAGS) {
    await db
      .insert(postTags)
      .values({ orgId, name: tag.name, color: tag.color, rule: tag.rule })
      .onConflictDoUpdate({
        target: [postTags.orgId, postTags.name],
        set: { color: tag.color, rule: tag.rule },
      });
  }
  step(TAGS.length + ' post tags, each with a working rule');
}

/* ------------------------------------------------------------- next steps */

function printNextSteps(): void {
  const missing = (
    [
      ['DATABASE_URL', process.env.DATABASE_URL ?? process.env.POSTGRES_URL],
      ['AUTH_SECRET', process.env.AUTH_SECRET],
      ['ENCRYPTION_KEY', process.env.ENCRYPTION_KEY],
      ['CRON_SECRET', process.env.CRON_SECRET],
      ['YOUTUBE_API_KEY', process.env.YOUTUBE_API_KEY],
    ] as const
  ).filter(([, value]) => !value).map(([name]) => name);

  console.log('');
  console.log('Seed complete. Nothing above is a metric -- Pressbox has the shape of the');
  console.log('landscape and no numbers at all until you ingest.');

  if (notes.length > 0) {
    console.log('');
    console.log('Worth knowing');
    console.log('-------------');
    for (const note of notes) console.log('  * ' + note);
  }

  if (missing.length > 0) {
    console.log('');
    console.log('Not configured yet');
    console.log('------------------');
    for (const name of missing) {
      const why = name === 'YOUTUBE_API_KEY'
        ? 'YouTube channels will be skipped. Bluesky and RSS work with no key at all.'
        : name === 'CRON_SECRET'
          ? 'The /api/cron/* endpoints will refuse every request until this is set.'
          : name === 'ENCRYPTION_KEY'
            ? 'Platform credentials and model API keys cannot be stored without it.'
            : name === 'AUTH_SECRET'
              ? 'Sign-in will not work without it.'
              : 'Required.';
      console.log('  * ' + name + ' - ' + why);
    }
  }

  console.log('');
  console.log('Next');
  console.log('----');
  console.log('  1. npm run db:push            apply the schema, if you have not already');
  console.log('  2. Set the keys listed above in .env.local (see .env.example)');
  console.log('  3. npm run ingest:once        pull the first real posts and audience numbers');
  console.log('  4. npm run dev                sign in as the owner above');
  console.log('');
  console.log('  Bluesky and RSS need no credentials, so step 3 produces real data');
  console.log('  immediately. YouTube joins in as soon as YOUTUBE_API_KEY is set.');
  console.log('');
}

/* -------------------------------------------------------------------- main */

async function main(): Promise<void> {
  console.log('');
  console.log('Seeding Pressbox');
  console.log('----------------');

  const orgId = await seedOrg();
  await seedAdmin(orgId);
  const companyIds = await seedCompanies(orgId);
  await seedLandscapes(orgId, companyIds);
  await seedTags(orgId);

  printNextSteps();
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error('');
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
