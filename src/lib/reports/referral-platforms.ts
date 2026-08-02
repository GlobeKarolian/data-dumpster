/**
 * Grouping referring domains into the platforms a human would name.
 *
 * Adobe reports hostnames. A hostname is not a platform: `com.google` is the
 * Google app on Android, `t.co` is X's link shortener, `linkin.bio` is Later's
 * link-in-bio service reached almost entirely from an Instagram profile. Ranked
 * as separate rows they split one platform's contribution across several lines
 * and every one of them reads smaller than it is. Google is the clearest case,
 * appearing as 761 and 46 subscriptions rather than the 807 it actually drove.
 *
 * Rollups are applied for display only. The underlying rows survive on every
 * group so the raw hostnames stay one click away and nothing is asserted that
 * cannot be traced back to the export.
 */
import type { FreeformDomainRow } from './adobe-freeform';

export type ReferralCategory = 'direct' | 'search' | 'social' | 'ai' | 'other';

export const CATEGORY_LABELS: Record<ReferralCategory, string> = {
  direct: 'Direct',
  search: 'Search',
  social: 'Social',
  ai: 'AI assistants',
  other: 'Other referrers',
};

type PlatformDef = {
  id: string;
  label: string;
  category: ReferralCategory;
  /** Exact hostnames Adobe emits for this platform. */
  domains: string[];
};

/**
 * Deliberately a fixed list rather than a heuristic.
 *
 * A regex over the hostname would fold `google.com` and `googleadservices.com`
 * together, and quietly reclassify a domain the week Adobe changes how it
 * normalises it. Anything not named here stays its own row under "Other", which
 * is a visible gap someone can close rather than a silent miscount.
 */
const PLATFORMS: PlatformDef[] = [
  { id: 'direct', label: 'Direct / Typed / Bookmarked', category: 'direct',
    domains: ['Typed/Bookmarked'] },

  { id: 'google', label: 'Google', category: 'search',
    domains: ['google.com', 'com.google', 'share.google', 'googleusercontent.com',
      'google.ca', 'google.co.uk', 'google.de', 'google.fr', 'google.nl', 'google.se',
      'google.at', 'google.pl', 'google.ie', 'google.co.nz', 'google.co.za',
      'google.co.in', 'google.co.id', 'google.com.au', 'google.com.hk',
      'google.com.ph', 'translate.goog'] },
  { id: 'bing', label: 'Bing', category: 'search', domains: ['bing.com', 'static.microsoft', 'ms.now'] },
  { id: 'duckduckgo', label: 'DuckDuckGo', category: 'search', domains: ['duckduckgo.com'] },
  { id: 'yahoo', label: 'Yahoo', category: 'search', domains: ['yahoo.com', 'yahoo.co.jp'] },
  { id: 'brave', label: 'Brave', category: 'search', domains: ['brave.com'] },
  { id: 'ecosia', label: 'Ecosia', category: 'search', domains: ['ecosia.org'] },
  { id: 'yandex', label: 'Yandex', category: 'search',
    domains: ['yandex.com', 'yandex.ru', 'yandex.com.tr'] },

  { id: 'facebook', label: 'Facebook', category: 'social',
    domains: ['facebook.com', 'm.facebook'] },
  { id: 'x', label: 'X', category: 'social', domains: ['t.co', 'x.com', 'com.twitter'] },
  { id: 'instagram', label: 'Instagram', category: 'social',
    domains: ['instagram.com', 'linkin.bio', 'lnk.bio', 'linktr.ee'] },
  { id: 'reddit', label: 'Reddit', category: 'social', domains: ['reddit.com', 'com.reddit'] },
  { id: 'linkedin', label: 'LinkedIn', category: 'social',
    domains: ['linkedin.com', 'com.linkedin', 'lnkd.in'] },
  { id: 'bluesky', label: 'Bluesky', category: 'social', domains: ['bsky.app'] },
  { id: 'threads', label: 'Threads', category: 'social', domains: ['threads.com', 'threads.net'] },
  { id: 'tiktok', label: 'TikTok', category: 'social', domains: ['tiktok.com'] },
  { id: 'nextdoor', label: 'Nextdoor', category: 'social', domains: ['nextdoor.com'] },
  { id: 'pinterest', label: 'Pinterest', category: 'social',
    domains: ['pinterest.com', 'com.pinterest'] },
  { id: 'youtube', label: 'YouTube', category: 'social', domains: ['youtube.com'] },
  { id: 'flipboard', label: 'Flipboard', category: 'social',
    domains: ['flipboard.com', 'flipboard.app'] },
  { id: 'tumblr', label: 'Tumblr', category: 'social', domains: ['tumblr.com'] },

  { id: 'chatgpt', label: 'ChatGPT', category: 'ai', domains: ['chatgpt.com'] },
  { id: 'claude', label: 'Claude', category: 'ai', domains: ['claude.ai'] },
  { id: 'perplexity', label: 'Perplexity', category: 'ai', domains: ['perplexity.ai'] },
  { id: 'copilot', label: 'Copilot', category: 'ai', domains: ['copilot.microsoft.com'] },
  { id: 'gemini', label: 'Gemini', category: 'ai', domains: ['gemini.google.com'] },
  { id: 'duckai', label: 'Duck.ai', category: 'ai', domains: ['duck.ai'] },
  { id: 'kagi', label: 'Kagi', category: 'ai', domains: ['kagi.com'] },
];

const BY_DOMAIN = new Map<string, PlatformDef>();
for (const p of PLATFORMS) for (const d of p.domains) BY_DOMAIN.set(d.toLowerCase(), p);

export type ReferralGroup = {
  id: string;
  label: string;
  category: ReferralCategory;
  loggedOutVisits: number;
  newSubscriptions: number;
  /** Null when there were no logged-out visits to divide by. */
  conversionRate: number | null;
  /** The hostnames that were folded in, kept for the drill-down. */
  members: FreeformDomainRow[];
};

export type ReferralRollup = {
  /** Everything except direct, ranked by new subscriptions. */
  platforms: ReferralGroup[];
  /** Broken out because direct traffic is not a referrer and should not rank. */
  direct: ReferralGroup | null;
  /** Category totals, direct excluded. */
  categories: { category: ReferralCategory; loggedOutVisits: number;
    newSubscriptions: number; conversionRate: number | null }[];
  /** Domains that drove no subscriptions at all. */
  zeroSubDomains: number;
  zeroSubVisits: number;
};

/** Null on a zero denominator, never Infinity. The house rule. */
function rate(subs: number, visits: number): number | null {
  return visits > 0 ? subs / visits : null;
}

export function rollUpReferrals(rows: FreeformDomainRow[]): ReferralRollup {
  const groups = new Map<string, ReferralGroup>();

  for (const row of rows) {
    const def = BY_DOMAIN.get(row.domain.toLowerCase());
    const id = def?.id ?? 'other:' + row.domain.toLowerCase();
    let g = groups.get(id);
    if (!g) {
      g = {
        id,
        label: def?.label ?? row.domain,
        category: def?.category ?? 'other',
        loggedOutVisits: 0,
        newSubscriptions: 0,
        conversionRate: null,
        members: [],
      };
      groups.set(id, g);
    }
    g.loggedOutVisits += row.loggedOutVisits ?? 0;
    g.newSubscriptions += row.newSubscriptions ?? 0;
    g.members.push(row);
  }

  for (const g of groups.values()) {
    g.conversionRate = rate(g.newSubscriptions, g.loggedOutVisits);
    g.members.sort((a, b) => (b.newSubscriptions ?? 0) - (a.newSubscriptions ?? 0));
  }

  const all = [...groups.values()];
  const direct = all.find((g) => g.category === 'direct') ?? null;
  const platforms = all
    .filter((g) => g.category !== 'direct')
    .sort((a, b) => b.newSubscriptions - a.newSubscriptions
      || b.loggedOutVisits - a.loggedOutVisits);

  const catOrder: ReferralCategory[] = ['search', 'social', 'ai', 'other'];
  const categories = catOrder.map((category) => {
    const members = platforms.filter((g) => g.category === category);
    const loggedOutVisits = members.reduce((s, g) => s + g.loggedOutVisits, 0);
    const newSubscriptions = members.reduce((s, g) => s + g.newSubscriptions, 0);
    return { category, loggedOutVisits, newSubscriptions,
      conversionRate: rate(newSubscriptions, loggedOutVisits) };
  }).filter((c) => c.loggedOutVisits > 0 || c.newSubscriptions > 0);

  const zero = rows.filter((r) => (r.newSubscriptions ?? 0) === 0);

  return {
    platforms,
    direct,
    categories,
    zeroSubDomains: zero.length,
    zeroSubVisits: zero.reduce((s, r) => s + (r.loggedOutVisits ?? 0), 0),
  };
}
