/**
 * /api/companies -- the entities being measured, ours and our competitors'.
 *
 * GET  every company in the org with its channels.
 * POST create one.
 *
 * Channels are attached separately (see ./[id]/channels) because adding one
 * requires a network round trip to resolve the handle, and a create endpoint
 * that can fail halfway through resolving four profiles is a bad create endpoint.
 */
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg, requireRole, HttpError } from '@/lib/session';
import { db } from '@/db';
import { channels, companies } from '@/db/schema';
import { slugify } from '@/lib/utils';
import { readJson } from '../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(160),
  website: z.url().max(500).nullish(),
  logoUrl: z.url().max(500).nullish(),
  segment: z.string().trim().max(80).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color.').nullish(),
});

export const GET = apiHandler(async () => {
  const { orgId } = await requireOrg();

  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      website: companies.website,
      logoUrl: companies.logoUrl,
      segment: companies.segment,
      color: companies.color,
      createdAt: companies.createdAt,
      channelId: channels.id,
      channelPlatform: channels.platform,
      channelHandle: channels.handle,
      channelProfileUrl: channels.profileUrl,
      channelAvatarUrl: channels.avatarUrl,
      channelActive: channels.active,
      channelLastIngestedAt: channels.lastIngestedAt,
    })
    .from(companies)
    .leftJoin(channels, eq(channels.companyId, companies.id))
    .where(eq(companies.orgId, orgId))
    .orderBy(asc(companies.name), asc(channels.platform));

  const byId = new Map<string, {
    id: string; name: string; slug: string; website: string | null;
    logoUrl: string | null; segment: string | null; color: string | null; createdAt: Date;
    channels: {
      id: string; platform: string; handle: string; profileUrl: string | null;
      avatarUrl: string | null; active: boolean; lastIngestedAt: Date | null;
    }[];
  }>();

  for (const r of rows) {
    const entry = byId.get(r.id) ?? {
      id: r.id, name: r.name, slug: r.slug, website: r.website, logoUrl: r.logoUrl,
      segment: r.segment, color: r.color, createdAt: r.createdAt, channels: [],
    };
    if (r.channelId && r.channelPlatform && r.channelHandle) {
      entry.channels.push({
        id: r.channelId, platform: r.channelPlatform, handle: r.channelHandle,
        profileUrl: r.channelProfileUrl, avatarUrl: r.channelAvatarUrl,
        active: r.channelActive ?? true, lastIngestedAt: r.channelLastIngestedAt,
      });
    }
    byId.set(r.id, entry);
  }

  return Response.json(
    { items: [...byId.values()] },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireRole('editor');
  const body = await readJson(req, createCompanySchema);

  const slug = slugify(body.name);
  if (!slug) throw new HttpError(422, 'That name has no usable characters for a URL.', 'invalid_name');

  const [existing] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.orgId, orgId), eq(companies.slug, slug)))
    .limit(1);
  if (existing) throw new HttpError(409, 'A company with that name already exists.', 'duplicate_company');

  const [created] = await db
    .insert(companies)
    .values({
      orgId,
      name: body.name,
      slug,
      website: body.website ?? null,
      logoUrl: body.logoUrl ?? null,
      segment: body.segment ?? null,
      color: body.color ?? null,
    })
    .returning();

  return Response.json({ ...created, channels: [] }, { status: 201 });
});
