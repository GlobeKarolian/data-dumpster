/**
 * Platform-specific UTM tagging. Every target carries its own template, so one
 * post going to Facebook, Threads and Bluesky leaves with three differently
 * tagged links and nobody types a UTM by hand.
 */
import type { PublishPlatform } from './platforms';

export interface UtmTemplate {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

/** Defaults when a target has no template of its own. */
export const DEFAULT_UTM: Record<PublishPlatform, Required<Pick<UtmTemplate, 'source' | 'medium' | 'campaign'>>> = {
  facebook: { source: 'facebook', medium: 'social', campaign: '{brand}' },
  instagram: { source: 'instagram', medium: 'social', campaign: '{brand}' },
  threads: { source: 'threads', medium: 'social', campaign: '{brand}' },
  bluesky: { source: 'bluesky', medium: 'social', campaign: '{brand}' },
  twitter: { source: 'twitter', medium: 'social', campaign: '{brand}' },
  linkedin: { source: 'linkedin', medium: 'social', campaign: '{brand}' },
  tiktok: { source: 'tiktok', medium: 'social', campaign: '{brand}' },
};

export interface UtmContext {
  platform: PublishPlatform;
  brand: string;
  /** Short id of the post, so clicks can be tied back to the exact send. */
  postRef: string;
  /** 'manual' or 'rss'. */
  origin: string;
  date: Date;
}

function fill(value: string, ctx: UtmContext): string {
  const ymd = ctx.date.toISOString().slice(0, 10);
  return value
    .replaceAll('{platform}', ctx.platform)
    .replaceAll('{brand}', slug(ctx.brand))
    .replaceAll('{post}', ctx.postRef)
    .replaceAll('{origin}', ctx.origin)
    .replaceAll('{date}', ymd)
    .trim();
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Add UTM parameters to a URL. Parameters already on the URL win: an editor who
 * typed a deliberate utm_campaign is not overwritten. Non-http links and
 * unparseable strings come back untouched.
 */
export function applyUtm(rawUrl: string, template: UtmTemplate | null | undefined, ctx: UtmContext): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return rawUrl;
  const merged: UtmTemplate = { ...DEFAULT_UTM[ctx.platform], content: '{post}', ...(template ?? {}) };
  for (const key of ['source', 'medium', 'campaign', 'content', 'term'] as const) {
    const raw = merged[key];
    if (!raw) continue;
    const value = fill(raw, ctx);
    const param = 'utm_' + key;
    if (value && !url.searchParams.has(param)) url.searchParams.set(param, value);
  }
  return url.toString();
}
