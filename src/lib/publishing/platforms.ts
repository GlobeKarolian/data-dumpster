/**
 * Publishing vocabulary, shared by server and client. No secrets, no node
 * builtins: the composer imports this to count characters as the user types.
 */

/** Networks Data Dumpster can publish to. Nextdoor is not here: Ayrshare does not support it. */
export const PUBLISH_PLATFORMS = [
  'facebook', 'instagram', 'threads', 'bluesky', 'twitter', 'linkedin', 'tiktok',
] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

export const PUBLISH_PLATFORM_LABELS: Record<PublishPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
  bluesky: 'Bluesky',
  twitter: 'X',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
};

/**
 * Text limits as each network counts them. X counts any URL as 23 characters
 * (t.co); the others count the URL as typed.
 */
export const TEXT_LIMITS: Record<PublishPlatform, number> = {
  facebook: 63206,
  instagram: 2200,
  threads: 500,
  bluesky: 300,
  twitter: 280,
  linkedin: 3000,
  tiktok: 2200,
};

/** Who sends a target's posts. `mock` records a fake success and never calls a network. */
export const PUBLISH_PROVIDERS = ['ayrshare', 'bluesky', 'mock'] as const;
export type PublishProvider = (typeof PUBLISH_PROVIDERS)[number];

/**
 * How the story link travels with the post on each network.
 *
 *  card    attached as a link card; the URL is NOT added to the text, so it
 *          costs no characters (Bluesky direct; Threads once direct publishing
 *          is approved).
 *  text    appended to the text; the network unfurls it.
 *  bio     Instagram and TikTok captions do not make links clickable, so the
 *          link goes on the brand's scheduled link-in-bio page instead.
 */
export type LinkMode = 'card' | 'text' | 'bio';

export function linkModeFor(platform: PublishPlatform, provider: PublishProvider): LinkMode {
  if (platform === 'instagram' || platform === 'tiktok') return 'bio';
  // Test-only accounts behave like the direct path so previews match what will ship.
  if (platform === 'bluesky' && provider !== 'ayrshare') return 'card';
  return 'text';
}

/** Grapheme-aware length, which is how Bluesky and Threads count. */
export function textLength(text: string): number {
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(seg.segment(text)).length;
  } catch {
    return [...text].length;
  }
}

const URL_RE = /https?:\/\/\S+/g;

/** Characters the network will charge for this text. */
export function chargedLength(platform: PublishPlatform, text: string): number {
  if (platform === 'twitter') return textLength(text.replace(URL_RE, 'x'.repeat(23)));
  return textLength(text);
}

/**
 * The exact text that will be sent, given the copy and how the link travels.
 * Kept here so the composer's counter and the sender can never disagree.
 */
export function finalText(copy: string, link: string | null, mode: LinkMode): string {
  const body = copy.trim();
  if (!link || mode === 'card' || mode === 'bio') return body;
  if (body.includes(link)) return body;
  return body ? body + '\n\n' + link : link;
}
