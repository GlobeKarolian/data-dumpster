import type { LinkMode, PublishPlatform } from '../platforms';

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string | null;
}

export interface SendRequest {
  platform: PublishPlatform;
  /** Exactly the text to post; the link is already in it unless linkMode is card or none. */
  text: string;
  link: string | null;
  linkMode: LinkMode;
  preview: LinkPreview | null;
  mediaUrls: string[];
  instagramCollaborators: string[];
  /** Stable per delivery, so a retry after a timeout cannot double-post. */
  idempotencyKey: string;
  /** Decrypted per-target secret, provider-specific JSON. */
  secret: Record<string, string> | null;
}

export type SendResult =
  | { ok: true; providerPostId: string | null; postUrl: string | null; detail?: unknown }
  | { ok: false; error: string; retryable: boolean; detail?: unknown };

export interface Publisher {
  readonly name: 'ayrshare' | 'bluesky' | 'mock';
  /** True when a retry with the same idempotency key cannot create a duplicate post. */
  readonly idempotent: boolean;
  send(req: SendRequest): Promise<SendResult>;
}
