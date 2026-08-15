/**
 * The one contract every platform integration implements.
 *
 * The whole point: adding Bluesky, Threads, Reddit, or a paid data vendor is a
 * new file in this directory and a line in the registry. Nothing else in the
 * app knows which platform it is looking at.
 */
import type { Platform, PostType } from '@/lib/types';

/**
 * The durable meaning of one collection attempt.
 *
 * `partial` and `failed` are presentation/audit statuses; they are not precise
 * enough for scheduling. In particular, a source that cannot expose a complete
 * timeline must not be treated like either a cursor the queue can follow or a
 * transient network failure it should keep buying again.
 */
export const COLLECTION_OUTCOMES = [
  'certified_complete',
  'continuation',
  'terminal_source_limitation',
  'retryable_operational_failure',
  'permanent_failure',
] as const;

export type CollectionOutcome = typeof COLLECTION_OUTCOMES[number];

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
  /** Exact stored profile URL. Prefer this over rebuilding URLs from handles. */
  profileUrl?: string | null;
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

interface FetchResultBase {
  posts: NormalizedPost[];
  audience: NormalizedAudience[];
  profile?: AdapterProfile;
  /** New cursor to persist. Merged over the existing cursor. */
  cursor?: Record<string, unknown>;
  warnings?: string[];
}

/**
 * Completeness is deliberately explicit. An adapter may certify the attempted
 * window only by returning `exhaustive: true`. A source limitation must carry
 * an actionable reason; omission must never be interpreted as certification.
 */
type FetchCompleteness =
  | {
      /** A certified window cannot also advertise more rows. */
      hasMore: false;
      exhaustive: true;
      incompleteReason?: never;
    }
  | {
      /** True only when a durable cursor can continue this same attempted window. */
      hasMore: boolean;
      exhaustive: false;
      /** Actionable explanation of the cap, selected feed, or source limitation. */
      incompleteReason: string;
    };

export type FetchResult = FetchResultBase & FetchCompleteness;

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
  /** Fields that a Settings surface may offer. Deployment-managed sources can leave this empty. */
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
