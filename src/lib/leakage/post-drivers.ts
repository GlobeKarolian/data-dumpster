/**
 * What drove one X post's reach: quote posts (and their own views), reposts
 * by large accounts, and replies. Pure helpers; the route owns X calls.
 */

/** Accepts a numeric id or any x.com / twitter.com status URL. */
export function parseTweetId(raw: string): string | null {
  const text = raw.trim();
  if (/^\d{5,25}$/.test(text)) return text;
  const match = text.match(/(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d{5,25})/i);
  return match ? match[1] : null;
}

export interface DriverAccount {
  username: string;
  name: string | null;
  followers: number;
  verified: string | null;
  bio: string;
}

export interface QuoteDriver extends DriverAccount {
  url: string;
  createdAt: string | null;
  views: number;
  likes: number;
  reposts: number;
  text: string;
}

/** Share of a total held by the top N items, for "the top 10 quotes drew X% of quote views". */
export function topShare(values: number[], n: number): number | null {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return null;
  const top = [...values].sort((a, b) => b - a).slice(0, n).reduce((sum, v) => sum + v, 0);
  return top / total;
}
