import type { PublishProvider } from '../platforms';
import { publishingLive } from '../access';
import { ayrsharePublisher } from './ayrshare';
import { blueskyPublisher } from './bluesky';
import type { Publisher, SendRequest, SendResult } from './types';

export type { Publisher, SendRequest, SendResult, LinkPreview } from './types';

/** Records a fake success. Used for every target unless PUBLISHING_LIVE=true. */
export const mockPublisher: Publisher = {
  name: 'mock',
  idempotent: true,
  async send(req: SendRequest): Promise<SendResult> {
    return {
      ok: true,
      providerPostId: 'mock-' + req.idempotencyKey,
      postUrl: null,
      detail: { mock: true, platform: req.platform, text: req.text, link: req.link, linkMode: req.linkMode },
    };
  },
};

export function publisherFor(provider: PublishProvider): Publisher {
  if (!publishingLive()) return mockPublisher;
  if (provider === 'ayrshare') return ayrsharePublisher;
  if (provider === 'bluesky') return blueskyPublisher;
  return mockPublisher;
}
