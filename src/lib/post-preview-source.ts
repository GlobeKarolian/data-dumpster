import type { Platform } from '@/lib/types';

export type PostPreviewKind = 'poster' | 'video';

export interface StoredPostPreviewSource {
  platform: Platform;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  raw: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/&amp;/gi, '&')
    : null;
}

/**
 * Meta media URLs are signed and short-lived. Only the two CDN families seen
 * in Instagram's post payloads are valid proxy targets.
 */
export function isAllowedInstagramMediaUrl(value: unknown): value is string {
  const candidate = stringValue(value);
  if (!candidate) return false;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return host.endsWith('.fbcdn.net') || host.endsWith('.cdninstagram.com');
  } catch {
    return false;
  }
}

/** Resolve one upstream redirect without ever leaving the CDN allowlist. */
export function allowedInstagramRedirect(
  currentUrl: string,
  location: string | null,
): string | null {
  if (!location) return null;
  try {
    const resolved = new URL(location, currentUrl).toString();
    return isAllowedInstagramMediaUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/** TikTok's public cover URLs rotate across regional tiktokcdn domains. */
export function isAllowedTikTokMediaUrl(value: unknown): value is string {
  const candidate = stringValue(value);
  if (!candidate) return false;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    return /^(?:[a-z0-9-]+\.)*tiktokcdn(?:-[a-z0-9-]+)?\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** Only a canonical public post URL may be sent to TikTok's oEmbed endpoint. */
export function isAllowedTikTokPermalink(value: unknown): value is string {
  const candidate = stringValue(value);
  if (!candidate) return false;

  try {
    const url = new URL(candidate);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'www.tiktok.com'
      && !url.username
      && !url.password
      && !url.port
      && /^\/@[a-z0-9._-]+\/video\/\d+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** Resolve one TikTok CDN redirect without allowing an arbitrary proxy target. */
export function allowedTikTokRedirect(
  currentUrl: string,
  location: string | null,
): string | null {
  if (!location) return null;
  try {
    const resolved = new URL(location, currentUrl).toString();
    return isAllowedTikTokMediaUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/** Stored TikTok covers are useful fallbacks, but their signatures expire. */
export function storedTikTokPosterCandidates(post: StoredPostPreviewSource): string[] {
  if (post.platform !== 'tiktok' || !isAllowedTikTokMediaUrl(post.thumbnailUrl)) return [];
  return [post.thumbnailUrl];
}

function addCandidate(out: string[], seen: Set<string>, value: unknown): void {
  const candidate = stringValue(value);
  if (!candidate || !isAllowedInstagramMediaUrl(candidate) || seen.has(candidate)) return;
  seen.add(candidate);
  out.push(candidate);
}

function childRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sourceObjects(raw: Record<string, unknown>): Record<string, unknown>[] {
  const objects = [raw];
  if (isRecord(raw.node)) objects.push(raw.node);
  if (isRecord(raw.media)) objects.push(raw.media);

  const sidecar = isRecord(raw.edge_sidecar_to_children)
    ? raw.edge_sidecar_to_children
    : null;
  for (const edge of childRecords(sidecar?.edges)) {
    if (isRecord(edge.node)) objects.push(edge.node);
  }
  return objects;
}

function addImageCandidates(
  out: string[],
  seen: Set<string>,
  source: Record<string, unknown>,
): void {
  for (const key of [
    'display_uri',
    'thumbnail_url',
    'display_url',
    'thumbnail_src',
    'thumbnail',
    'image_url',
  ]) {
    addCandidate(out, seen, source[key]);
  }
  for (const candidate of stringValues(source.images)) {
    addCandidate(out, seen, candidate);
  }

  const versions = isRecord(source.image_versions2) ? source.image_versions2 : null;
  for (const candidate of childRecords(versions?.candidates)) {
    addCandidate(out, seen, candidate.url);
  }
  for (const candidate of childRecords(source.display_resources)) {
    addCandidate(out, seen, candidate.src);
  }
  for (const candidate of childRecords(source.thumbnail_resources)) {
    addCandidate(out, seen, candidate.src);
  }
}

function addVideoCandidates(
  out: string[],
  seen: Set<string>,
  source: Record<string, unknown>,
): void {
  addCandidate(out, seen, source.video_url);
  for (const candidate of stringValues(source.videos)) {
    addCandidate(out, seen, candidate);
  }
  for (const version of childRecords(source.video_versions)) {
    addCandidate(out, seen, version.url);
  }
}

const MAX_STORED_POSTERS = 12;
const MAX_STORED_VIDEOS = 6;

/**
 * Add candidates from both the compact persisted shape and legacy vendor
 * payloads. Legacy support is read-only: new writes are always normalized to
 * the compact `preview` object by `sanitizePooledPostRaw` below.
 */
function addRawPreviewCandidates(
  out: string[],
  seen: Set<string>,
  raw: Record<string, unknown>,
  kind: PostPreviewKind,
): void {
  const preview = isRecord(raw.preview) ? raw.preview : null;
  const persisted = kind === 'poster' ? preview?.posterUrls : preview?.videoUrls;
  for (const value of stringValues(persisted)) addCandidate(out, seen, value);

  for (const source of sourceObjects(raw)) {
    if (kind === 'poster') addImageCandidates(out, seen, source);
    else addVideoCandidates(out, seen, source);
  }
}

function sanitizeInstagramRaw(raw: Record<string, unknown>): Record<string, unknown> | null {
  const posterUrls: string[] = [];
  const videoUrls: string[] = [];
  addRawPreviewCandidates(posterUrls, new Set<string>(), raw, 'poster');
  addRawPreviewCandidates(videoUrls, new Set<string>(), raw, 'video');

  const preview: Record<string, unknown> = {};
  if (posterUrls.length > 0) preview.posterUrls = posterUrls.slice(0, MAX_STORED_POSTERS);
  if (videoUrls.length > 0) preview.videoUrls = videoUrls.slice(0, MAX_STORED_VIDEOS);
  return Object.keys(preview).length > 0 ? { preview } : null;
}

type RawSanitizer = (raw: Record<string, unknown>) => Record<string, unknown> | null;
const DROP_RAW: RawSanitizer = () => null;

/**
 * Global post rows contain public comparison facts, not vendor response
 * archives. Every platform makes an explicit choice here; a newly added
 * platform fails the TypeScript build until it chooses a policy. Unknown keys
 * are never copied. Instagram retains only validated CDN preview candidates
 * because the authenticated preview proxy uses them after signed URLs expire.
 */
const POOLED_POST_RAW_SANITIZERS = {
  facebook: DROP_RAW,
  instagram: sanitizeInstagramRaw,
  twitter: DROP_RAW,
  youtube: DROP_RAW,
  tiktok: DROP_RAW,
  linkedin: DROP_RAW,
  bluesky: DROP_RAW,
  // Threads media is served by the same signed Meta CDN families as Instagram.
  // Keep only the bounded, validated preview candidates—not the vendor record.
  threads: sanitizeInstagramRaw,
  reddit: DROP_RAW,
  rss: DROP_RAW,
} satisfies Record<Platform, RawSanitizer>;

/** Apply the per-platform public allowlist at the one pooled write boundary. */
export function sanitizePooledPostRaw(
  platform: Platform,
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!raw) return null;
  return POOLED_POST_RAW_SANITIZERS[platform](raw);
}

/**
 * Extract only explicitly-known media fields from a stored Instagram payload.
 * Raw records often contain unrelated profile and destination URLs, so this is
 * intentionally not a recursive URL search.
 */
export function storedInstagramPreviewCandidates(
  post: StoredPostPreviewSource,
  kind: PostPreviewKind,
): string[] {
  if (post.platform !== 'instagram') return [];

  const out: string[] = [];
  const seen = new Set<string>();
  if (kind === 'poster') addCandidate(out, seen, post.thumbnailUrl);
  else addCandidate(out, seen, post.mediaUrl);

  if (post.raw) addRawPreviewCandidates(out, seen, post.raw, kind);

  // Some purchased-source photo records keep the image only in media_url.
  if (kind === 'poster') addCandidate(out, seen, post.mediaUrl);
  return out;
}

/** Threads uses the same signed Meta CDN URLs but has its own platform guard. */
export function storedThreadsPreviewCandidates(
  post: StoredPostPreviewSource,
  kind: PostPreviewKind,
): string[] {
  if (post.platform !== 'threads') return [];

  const out: string[] = [];
  const seen = new Set<string>();
  if (kind === 'poster') addCandidate(out, seen, post.thumbnailUrl);
  else addCandidate(out, seen, post.mediaUrl);
  if (post.raw) addRawPreviewCandidates(out, seen, post.raw, kind);
  if (kind === 'poster') addCandidate(out, seen, post.mediaUrl);
  return out;
}
