export interface StoredPoster { stream: ReadableStream; contentType: string; contentLength: number; etag: string }
export interface ArchiveDependencies {
  authorize(landscapeId: string): Promise<void>;
  storedUrl(postId: string, landscapeId: string): Promise<string | null>;
  stream(url: string): Promise<StoredPoster | null>;
}
export async function readStoredPoster(postId: string, landscapeId: string, deps: ArchiveDependencies): Promise<StoredPoster | null> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(postId) || !uuid.test(landscapeId)) return null;
  await deps.authorize(landscapeId);
  const url = await deps.storedUrl(postId, landscapeId);
  return url ? deps.stream(url) : null;
}
