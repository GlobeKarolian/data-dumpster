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

function addCandidate(out: string[], seen: Set<string>, value: unknown): void {
  const candidate = stringValue(value);
  if (!candidate || !isAllowedInstagramMediaUrl(candidate) || seen.has(candidate)) return;
  seen.add(candidate);
  out.push(candidate);
}

function childRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
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
  for (const version of childRecords(source.video_versions)) {
    addCandidate(out, seen, version.url);
  }
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

  if (post.raw) {
    for (const source of sourceObjects(post.raw)) {
      if (kind === 'poster') addImageCandidates(out, seen, source);
      else addVideoCandidates(out, seen, source);
    }
  }

  // Some purchased-source photo records keep the image only in media_url.
  if (kind === 'poster') addCandidate(out, seen, post.mediaUrl);
  return out;
}

