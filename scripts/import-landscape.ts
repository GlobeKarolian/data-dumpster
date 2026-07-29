/**
 * Import a landscape from a Rival IQ company export.
 *
 * WHY THIS EXISTS
 * Handles typed by hand are how @thebside became a private individual named
 * Kevin. This CSV carries profile URLs that the incumbent tool already resolved
 * and has been polling for years, which makes it the single most trustworthy
 * source of handles available. Importing it beats any amount of guessing.
 *
 * Usage: tsx scripts/import-landscape.ts data/rivaliq-companies.csv
 */
import { readFileSync } from 'node:fs';
import { db } from '@/db';
import { companies, channels, landscapes, landscapeCompanies } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { slugify } from '@/lib/utils';
import { getAdapter, hasAdapter } from '@/lib/adapters/registry';
import type { Platform } from '@/lib/types';

/** CSV columns that hold a profile URL, mapped to our platform vocabulary. */
const COLUMNS: { column: string; platform: Platform }[] = [
  { column: 'twitter', platform: 'twitter' },
  { column: 'facebook', platform: 'facebook' },
  { column: 'youtube', platform: 'youtube' },
  { column: 'instagram', platform: 'instagram' },
  { column: 'tiktok', platform: 'tiktok' },
];

/** Minimal RFC 4180 reader. The export quotes any name containing a comma. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch !== '\r') field += ch;
  }
  if (field || row.length > 0) { row.push(field); rows.push(row); }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

async function main() {
  const path = process.argv[2] ?? 'data/rivaliq-companies.csv';
  const rows = parseCsv(readFileSync(path, 'utf8'));
  console.log('Read ' + rows.length + ' companies from ' + path + '\n');

  const [anyCompany] = await db.select().from(companies).limit(1);
  if (!anyCompany) throw new Error('Seed the database first.');
  const orgId = anyCompany.orgId;

  const [landscape] = await db.select().from(landscapes)
    .where(and(eq(landscapes.orgId, orgId), eq(landscapes.slug, 'boston-news-landscape')));

  let newCompanies = 0;
  let newChannels = 0;
  let skipped = 0;

  for (const row of rows) {
    const name = row.company_name?.trim();
    if (!name) continue;
    const slug = slugify(name);

    let [company] = await db.select().from(companies)
      .where(and(eq(companies.orgId, orgId), eq(companies.slug, slug)));

    if (!company) {
      [company] = await db.insert(companies)
        .values({ orgId, name, slug, website: row.company_url || null })
        .returning();
      newCompanies += 1;
    }

    const added: string[] = [];

    for (const { column, platform } of COLUMNS) {
      const url = row[column]?.trim();
      if (!url) continue;
      if (!hasAdapter(platform)) { skipped += 1; continue; }

      let handle: string;
      try {
        handle = getAdapter(platform).parseHandle(url);
      } catch {
        skipped += 1;
        continue;
      }

      const exists = await db.select({ id: channels.id }).from(channels)
        .where(and(
          eq(channels.companyId, company.id),
          eq(channels.platform, platform),
          eq(channels.handle, handle),
        ));
      if (exists.length > 0) continue;

      await db.insert(channels).values({
        companyId: company.id,
        platform,
        handle,
        profileUrl: url,
        isOwned: false,
        active: true,
        meta: { importedFrom: 'rivaliq-export', rivaliqCompanyId: row.company_id ?? null },
      }).onConflictDoNothing();

      newChannels += 1;
      added.push(platform);

      // Threads accounts are created from an Instagram login and in practice
      // carry the same handle, so the Instagram column doubles as the Threads
      // one. Marked in meta as derived rather than exported, because it is an
      // inference and the first failed ingest should say so plainly.
      if (platform === 'instagram') {
        const threadsExists = await db.select({ id: channels.id }).from(channels)
          .where(and(
            eq(channels.companyId, company.id),
            eq(channels.platform, 'threads'),
            eq(channels.handle, handle),
          ));
        if (threadsExists.length === 0) {
          await db.insert(channels).values({
            companyId: company.id,
            platform: 'threads',
            handle,
            profileUrl: 'https://www.threads.net/@' + handle,
            isOwned: false,
            active: true,
            meta: { derivedFrom: 'instagram', note: 'Handle inferred from Instagram, not exported.' },
          }).onConflictDoNothing();
          newChannels += 1;
          added.push('threads');
        }
      }
    }

    if (landscape) {
      const member = await db.select().from(landscapeCompanies).where(and(
        eq(landscapeCompanies.landscapeId, landscape.id),
        eq(landscapeCompanies.companyId, company.id),
      ));
      if (member.length === 0) {
        await db.insert(landscapeCompanies)
          .values({ landscapeId: landscape.id, companyId: company.id, sortOrder: 100 });
      }
    }

    console.log('  ' + name.padEnd(30) + (added.length ? added.join(', ') : 'no new channels'));
  }

  console.log('\n' + newCompanies + ' companies created, ' + newChannels + ' channels added, '
    + skipped + ' columns skipped (no adapter or unparseable).');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
