/**
 * Rebuild the two landscapes from Rival IQ exports.
 *
 * Intentionally destructive about landscape MEMBERSHIP but never about data:
 * it clears and rebuilds the join rows so the landscapes match the CSVs exactly,
 * and it deactivates landscapes not named here. Companies, channels and posts
 * are left untouched, because a company dropping out of a competitive set is a
 * change of framing, not a reason to throw away its history.
 *
 * Usage: tsx scripts/build-landscapes.ts
 */
import { readFileSync } from 'node:fs';
import { db } from '@/db';
import { companies, channels, landscapes, landscapeCompanies } from '@/db/schema';
import { and, eq, notInArray } from 'drizzle-orm';
import { slugify } from '@/lib/utils';
import { getAdapter, hasAdapter } from '@/lib/adapters/registry';
import type { Platform } from '@/lib/types';

const COLUMNS: { column: string; platform: Platform }[] = [
  { column: 'twitter', platform: 'twitter' },
  { column: 'facebook', platform: 'facebook' },
  { column: 'youtube', platform: 'youtube' },
  { column: 'instagram', platform: 'instagram' },
  { column: 'tiktok', platform: 'tiktok' },
];

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; }
      else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

interface Spec { name: string; slug: string; file: string; focus: string }

const SPECS: Spec[] = [
  { name: 'BGM', slug: 'bgm', file: 'data/bgm-brands.csv', focus: 'The Boston Globe' },
  { name: 'Boston News Market', slug: 'boston-news-market', file: 'data/boston-news-market.csv', focus: 'The Boston Globe' },
];

async function upsertCompanyAndChannels(orgId: string, row: Record<string, string>) {
  const name = row.company_name?.trim();
  if (!name) return null;
  const slug = slugify(name);

  let [company] = await db.select().from(companies)
    .where(and(eq(companies.orgId, orgId), eq(companies.slug, slug)));
  if (!company) {
    [company] = await db.insert(companies)
      .values({ orgId, name, slug, website: row.company_url || null }).returning();
  }

  for (const { column, platform } of COLUMNS) {
    const url = row[column]?.trim();
    if (!url || !hasAdapter(platform)) continue;
    let handle: string;
    try { handle = getAdapter(platform).parseHandle(url); } catch { continue; }

    const exists = await db.select({ id: channels.id }).from(channels).where(and(
      eq(channels.companyId, company.id), eq(channels.platform, platform), eq(channels.handle, handle),
    ));
    if (exists.length === 0) {
      await db.insert(channels).values({
        companyId: company.id, platform, handle, profileUrl: url,
        isOwned: false, active: true,
        meta: { importedFrom: 'rivaliq-export' },
      }).onConflictDoNothing();
    }

    // A Threads account is created from an Instagram login and carries the same
    // handle, so the Instagram column doubles as the Threads one. Flagged as
    // inferred so a failed ingest explains itself rather than looking like a bug.
    if (platform === 'instagram') {
      const th = await db.select({ id: channels.id }).from(channels).where(and(
        eq(channels.companyId, company.id), eq(channels.platform, 'threads'), eq(channels.handle, handle),
      ));
      if (th.length === 0) {
        await db.insert(channels).values({
          companyId: company.id, platform: 'threads', handle,
          profileUrl: 'https://www.threads.com/@' + handle,
          isOwned: false, active: true,
          meta: { derivedFrom: 'instagram', note: 'Handle inferred from Instagram, not exported.' },
        }).onConflictDoNothing();
      }
    }
  }
  return company;
}

async function main() {
  const [any] = await db.select().from(companies).limit(1);
  if (!any) throw new Error('Seed the database first.');
  const orgId = any.orgId;

  const keepSlugs: string[] = [];

  for (const spec of SPECS) {
    const rows = parseCsv(readFileSync(spec.file, 'utf8'));
    console.log('\n' + spec.name + ' (' + rows.length + ' companies from ' + spec.file + ')');

    const memberIds: string[] = [];
    let focusId: string | null = null;

    for (const row of rows) {
      const company = await upsertCompanyAndChannels(orgId, row);
      if (!company) continue;
      memberIds.push(company.id);
      if (company.name.trim().toLowerCase() === spec.focus.toLowerCase()) focusId = company.id;
      console.log('  ' + company.name);
    }

    let [ls] = await db.select().from(landscapes)
      .where(and(eq(landscapes.orgId, orgId), eq(landscapes.slug, spec.slug)));
    if (!ls) {
      [ls] = await db.insert(landscapes)
        .values({ orgId, name: spec.name, slug: spec.slug, focusCompanyId: focusId }).returning();
    } else {
      await db.update(landscapes)
        .set({ name: spec.name, focusCompanyId: focusId }).where(eq(landscapes.id, ls.id));
    }

    // Rebuild membership so the landscape matches the CSV exactly. Removing a
    // join row changes framing only; the company and its posts survive.
    await db.delete(landscapeCompanies).where(eq(landscapeCompanies.landscapeId, ls.id));
    for (const [i, companyId] of memberIds.entries()) {
      await db.insert(landscapeCompanies)
        .values({ landscapeId: ls.id, companyId, sortOrder: i }).onConflictDoNothing();
    }

    keepSlugs.push(spec.slug);
    console.log('  -> ' + memberIds.length + ' members, focus = ' + (focusId ? spec.focus : 'NONE'));
  }

  // Any other landscape is a leftover from setup. Drop the landscape rows only.
  const stale = await db.delete(landscapes)
    .where(and(eq(landscapes.orgId, orgId), notInArray(landscapes.slug, keepSlugs)))
    .returning({ name: landscapes.name });
  if (stale.length) console.log('\nremoved stale landscapes: ' + stale.map((s) => s.name).join(', '));

  console.log('\nDone. Companies and posts were not touched.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
