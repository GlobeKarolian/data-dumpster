/**
 * The one contract every platform integration implements.
 *
 * The whole point: adding Bluesky, Threads, Reddit, or a paid data vendor is a
 * new file in this directory and a line in the registry. Nothing else in the
 * app knows which platform it is looking at.
 */
import type { Platform, PostType } from '@/lib/types';

/** A post as the rest of the system understands it, regardless of origin. */
export interface NormalizedPost {
  externalId: string;
  postedAt: Date;
  type: PostType;
  text?: string | null;
  permalink?: string | null;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  language?: string | null;
  hashtags: string[];
  mentions: string[];
  urls: string[];
  /** Likes, reactions, favorites, hearts, upvotes. */
  applause: number;
  /** Comments, replies. */
  conversation: number;
  /** Shares, retweets, reposts, quote posts. */
  amplification: number;
  /** Saves/bookmarks where the platform exposes them. */
  saves: number;
  /** Video/impression views where exposed. */
  views: number;
  raw?: Record<string, unknown>;
}

export interface NormalizedAudience {
  day: string; // YYYY-MM-DD
  followers: number;
  following?: number | null;
  extra?: Record<string, number>;
}

export interface AdapterProfile {
  externalId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string | null;
  profileUrl?: string | null;
  followers?: number;
  meta?: Record<string, unknown>;
}

export interface FetchContext {
  /** Handle or resolved platform id for the channel being read. */
  handle: string;
  externalId?: string | null;
  /** Opaque adapter state persisted on the channel row between runs. */
  cursor: Record<string, unknown>;
  /** Only fetch posts at or after this instant. */
  since: Date;
  until: Date;
  /** Decrypted credentials for this platform, if the org has configured any. */
  credentials: Record<string, string>;
  /** Cap on posts to pull in one run; adapters must respect it. */
  limit: number;
  /** Called by the adapter each time it hits the network. Used for cost/quota telemetry. */
  onApiCall?: () => void;
  signal?: AbortSignal;
}

export interface FetchResult {
  posts: NormalizedPost[];
  audience: NormalizedAudience[];
  profile?: AdapterProfile;
  /** New cursor to persist. Merged over the existing cursor. */
  cursor?: Record<string, unknown>;
  /** True when more data is available and the caller should schedule another run. */
  hasMore?: boolean;
  /**
   * False when the source hit a hard vendor cap and exposes no continuation.
   * Such a run may still land useful rows, but it must never certify the
   * requested window as complete.
   */
  exhaustive?: boolean;
  /** Actionable reason paired with exhaustive=false. */
  incompleteReason?: string;
  warnings?: string[];
}

export interface CredentialField {
  key: string;
  label: string;
  help?: string;
  secret?: boolean;
  required?: boolean;
}

export interface ChannelAdapter {
  platform: Platform;
  displayName: string;
  /** Human-readable note shown in Settings about what access this needs. */
  accessNotes: string;
  /** Credential fields this adapter needs. Empty array = works with no auth. */
  credentialFields: CredentialField[];
  /** Documented quota, used by the scheduler to pace runs. */
  rateLimit: { callsPerWindow: number; windowSeconds: number };
  /** True when the adapter can run without any org credentials configured. */
  worksUnauthenticated: boolean;

  /** Turn a URL or handle into a canonical handle. Throws on unparseable input. */
  parseHandle(input: string): string;
  /** Resolve a handle to a platform id + profile. */
  resolveProfile(handle: string, credentials: Record<string, string>): Promise<AdapterProfile>;
  /** Pull posts and audience for a window. Must be idempotent. */
  fetch(ctx: FetchContext): Promise<FetchResult>;
  /** Cheap credential validation for the Settings health check. */
  healthCheck?(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }>;
}

/** Thrown by adapters so the runner can distinguish retryable from fatal. */
export class AdapterError extends Error {
  constructor(
    message: string,
    readonly opts: {
      platform: Platform;
      retryable?: boolean;
      status?: number;
      retryAfterSeconds?: number;
    },
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}
