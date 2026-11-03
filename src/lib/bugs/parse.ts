/**
 * Pure helpers for bug reports: no database, no network, safe in tests.
 *
 * A bug report is free text written by a social editor in a hurry. The most
 * common report ("we're not seeing this post") is answerable from the
 * database alone, provided the post link in the text can be turned into a
 * platform, an account and a post key. That parsing lives here.
 */
import type { Platform } from '@/lib/types';

export const BUG_AREAS = [
  'missing_data',
  'wrong_numbers',
  'collection',
  'reports',
  'publishing',
  'ai',
  'interface',
  'access',
  'other',
] as const;
export type BugArea = (typeof BUG_AREAS)[number];

export const BUG_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

export const BUG_STATUSES = ['new', 'triaged', 'in_progress', 'fixed', 'wont_fix', 'duplicate'] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export const BUG_AREA_LABELS: Record<BugArea, string> = {
  missing_data: 'Missing posts or data',
  wrong_numbers: 'Wrong numbers',
  collection: 'Collection',
  reports: 'Reports and exports',
  publishing: 'Publishing',
  ai: 'AI features',
  interface: 'Interface',
  access: 'Access and sign-in',
  other: 'Other',
};

export interface ParsedPostUrl {
  url: string;
  platform: Platform;
  /** Account handle when the URL carries one, lowercased, without @. */
  handle: string | null;
  /** Shortcode, status id or other key that identifies the post on its platform. */
  postKey: string;
}

/** Every http(s) URL in a block of text, trailing punctuation trimmed, deduplicated. */
export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    const url = raw.replace(/[.,;:!?]+$/, '');
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

function cleanHandle(h: string | undefined | null): string | null {
  if (!h) return null;
  const v = decodeURIComponent(h).replace(/^@/, '').trim().toLowerCase();
  return v || null;
}

/** Instagram path segments that are not account handles. */
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts']);

/**
 * Turn a social post link into platform, handle and post key.
 * Returns null for profile links, articles and anything unrecognized.
 */
export function parseSocialPostUrl(input: string): ParsedPostUrl | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const url = input;

  if (host === 'instagram.com') {
    const i = parts.findIndex((p) => ['p', 'reel', 'reels', 'tv'].includes(p));
    if (i < 0 || !parts[i + 1]) return null;
    const handle = i > 0 && !IG_RESERVED.has(parts[i - 1]) ? cleanHandle(parts[i - 1]) : null;
    return { url, platform: 'instagram', handle, postKey: parts[i + 1] };
  }

  if (host === 'x.com' || host === 'twitter.com') {
    const i = parts.indexOf('status');
    if (i < 1 || !parts[i + 1]) return null;
    return { url, platform: 'twitter', handle: cleanHandle(parts[i - 1]), postKey: parts[i + 1] };
  }

  if (host === 'threads.net' || host === 'threads.com') {
    const i = parts.indexOf('post');
    if (i < 1 || !parts[i + 1]) return null;
    return { url, platform: 'threads', handle: cleanHandle(parts[i - 1]), postKey: parts[i + 1] };
  }

  if (host === 'tiktok.com') {
    const i = parts.indexOf('video');
    if (i < 0 || !parts[i + 1]) return null;
    const owner = i > 0 && parts[i - 1].startsWith('@') ? parts[i - 1] : null;
    return { url, platform: 'tiktok', handle: cleanHandle(owner), postKey: parts[i + 1] };
  }

  if (host === 'bsky.app') {
    if (parts[0] !== 'profile' || parts[2] !== 'post' || !parts[3]) return null;
    return { url, platform: 'bluesky', handle: cleanHandle(parts[1]), postKey: parts[3] };
  }

  if (host === 'youtube.com' || host === 'youtu.be') {
    if (host === 'youtu.be' && parts[0]) return { url, platform: 'youtube', handle: null, postKey: parts[0] };
    const v = u.searchParams.get('v');
    if (v) return { url, platform: 'youtube', handle: null, postKey: v };
    if ((parts[0] === 'shorts' || parts[0] === 'live') && parts[1]) {
      return { url, platform: 'youtube', handle: null, postKey: parts[1] };
    }
    return null;
  }

  if (host === 'facebook.com' || host === 'fb.com') {
    const storyId = u.searchParams.get('story_fbid') ?? u.searchParams.get('fbid');
    if (storyId) return { url, platform: 'facebook', handle: null, postKey: storyId };
    const v = u.searchParams.get('v');
    if (parts[0] === 'watch' && v) return { url, platform: 'facebook', handle: null, postKey: v };
    for (const marker of ['posts', 'videos', 'reel', 'photos']) {
      const i = parts.indexOf(marker);
      if (i >= 0 && parts[i + 1]) {
        const handle = i > 0 ? cleanHandle(parts[i - 1]) : null;
        return { url, platform: 'facebook', handle, postKey: parts[parts.length - 1] };
      }
    }
    return null;
  }

  if (host === 'linkedin.com') {
    const activity = u.pathname.match(/activity[:-](\d{10,})/);
    if (activity) return { url, platform: 'linkedin', handle: null, postKey: activity[1] };
    return null;
  }

  if (host === 'reddit.com' || host === 'old.reddit.com') {
    const i = parts.indexOf('comments');
    if (i < 0 || !parts[i + 1]) return null;
    return { url, platform: 'reddit', handle: null, postKey: parts[i + 1] };
  }

  return null;
}

/** All recognizable post links in a report, at most `limit`. */
export function postUrlsIn(text: string, limit = 5): ParsedPostUrl[] {
  const out: ParsedPostUrl[] = [];
  for (const url of extractUrls(text)) {
    const parsed = parseSocialPostUrl(url);
    if (parsed && !out.some((p) => p.platform === parsed.platform && p.postKey === parsed.postKey)) {
      out.push(parsed);
    }
    if (out.length >= limit) break;
  }
  return out;
}

const RULES: Array<{ area: BugArea; pattern: RegExp }> = [
  { area: 'access', pattern: /\b(log ?in|sign ?in|password|access|permission|invite|locked out|can'?t see the landscape)\b/i },
  { area: 'publishing', pattern: /\b(publish|scheduled post|ayrshare|drafter|queue to post|posting tool)\b/i },
  { area: 'reports', pattern: /\b(weekly report|report|pptx|powerpoint|csv|export|brief|slack delivery)\b/i },
  { area: 'ai', pattern: /\b(ask|tagging|tags?|narrative|summary|ai|model|hallucinat)\b/i },
  { area: 'wrong_numbers', pattern: /\b(wrong|incorrect|off by|doesn'?t match|too (high|low)|engagement|followers?|views?|numbers?|count)\b/i },
  { area: 'missing_data', pattern: /\b(missing|not (seeing|showing|there|appearing)|didn'?t (show|pick|get)|missed|no posts?|can'?t find|isn'?t (in|on|showing))\b/i },
  { area: 'collection', pattern: /\b(stale|not updat|last collected|refresh|stopped collecting|behind)\b/i },
  { area: 'interface', pattern: /\b(button|page|screen|layout|overflow|click|crash|blank|loading|spinner|error message|broken)\b/i },
];

/**
 * Rule-based triage. Used when no model connection is configured or the model
 * answer fails verification, so every report still gets an area and severity.
 */
export function heuristicTriage(text: string, hasPostLinks: boolean): { area: BugArea; severity: BugSeverity } {
  let area: BugArea = 'other';
  // A post link plus "missing"-style wording is the classic report.
  if (hasPostLinks && RULES.find((r) => r.area === 'missing_data')!.pattern.test(text)) {
    area = 'missing_data';
  } else {
    // Order matters: the specific areas are checked before the generic ones.
    const ordered: BugArea[] = ['access', 'publishing', 'missing_data', 'wrong_numbers', 'collection', 'reports', 'ai', 'interface'];
    for (const candidate of ordered) {
      if (RULES.find((r) => r.area === candidate)!.pattern.test(text)) {
        area = candidate;
        break;
      }
    }
    if (area === 'other' && hasPostLinks) area = 'missing_data';
  }

  let severity: BugSeverity = 'medium';
  if (/\b(everything|all (posts|accounts|data)|down|outage|can'?t (use|log)|nothing (loads|works)|urgent|asap|leadership|linda)\b/i.test(text)) {
    severity = 'high';
  } else if (/\b(typo|cosmetic|minor|nit|small|alignment|spacing)\b/i.test(text)) {
    severity = 'low';
  } else if (area === 'access') {
    severity = 'high';
  }
  return { area, severity };
}

/**
 * Every number the model writes must already exist in the fact sheet it was
 * given (the product's third rule). Returns the numbers that do not.
 * Thousands separators and trailing ".0" are normalized on both sides.
 */
export function unsupportedNumbers(text: string, factSheet: string): string[] {
  const norm = (n: string) => n.replace(/,/g, '').replace(/\.0+$/, '');
  const known = new Set((factSheet.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(norm));
  const bad: string[] = [];
  for (const n of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    if (!known.has(norm(n)) && !bad.includes(n)) bad.push(n);
  }
  return bad;
}

/** Human reference shown to reporters and in Slack. */
export function bugRef(number: number): string {
  return 'BUG-' + number;
}
