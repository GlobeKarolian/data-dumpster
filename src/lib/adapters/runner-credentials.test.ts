import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLATFORMS } from '@/lib/types';
import { publicSourceCredentials } from './public-sources';
import { pooledFetchCursor } from './runner';

const configuredEnvironment: Record<string, string> = {
  YOUTUBE_API_KEY: 'youtube-public-key',
  ENSEMBLEDATA_TOKEN: 'ensemble-vendor-token',
  BRIGHTDATA_API_KEY: 'bright-vendor-key',
  BLUESKY_IDENTIFIER: 'public.bsky.social',
  BLUESKY_APP_PASSWORD: 'bluesky-app-password',
  META_ACCESS_TOKEN: 'forbidden-meta-token',
  META_IG_USER_ID: 'forbidden-instagram-owner',
  META_APP_ID: 'forbidden-meta-app',
  META_APP_SECRET: 'forbidden-meta-secret',
  TIKTOK_ACCESS_TOKEN: 'forbidden-tiktok-token',
  TIKTOK_REFRESH_TOKEN: 'forbidden-tiktok-refresh',
  TIKTOK_CLIENT_KEY: 'forbidden-tiktok-client',
  TIKTOK_CLIENT_SECRET: 'forbidden-tiktok-secret',
  LINKEDIN_ACCESS_TOKEN: 'forbidden-linkedin-admin',
  TWITTER_BEARER_TOKEN: 'forbidden-x-bearer',
};

describe('pooled collection source containment', () => {
  it('uses only deployment public-source credentials for each platform', () => {
    assert.deepEqual(publicSourceCredentials('youtube', configuredEnvironment), {
      apiKey: 'youtube-public-key',
    });
    assert.deepEqual(publicSourceCredentials('facebook', configuredEnvironment), {
      brightDataApiKey: 'bright-vendor-key',
    });
    assert.deepEqual(publicSourceCredentials('instagram', configuredEnvironment), {
      brightDataApiKey: 'bright-vendor-key',
    });
    assert.deepEqual(publicSourceCredentials('twitter', configuredEnvironment), {
      brightDataApiKey: 'bright-vendor-key',
      ensembleDataToken: 'ensemble-vendor-token',
    });
    assert.deepEqual(publicSourceCredentials('tiktok', configuredEnvironment), {
      brightDataApiKey: 'bright-vendor-key',
    });
    assert.deepEqual(publicSourceCredentials('threads', configuredEnvironment), {
      brightDataApiKey: 'bright-vendor-key',
    });
    assert.deepEqual(publicSourceCredentials('reddit', configuredEnvironment), {
      ensembleDataToken: 'ensemble-vendor-token',
    });
    assert.deepEqual(publicSourceCredentials('linkedin', configuredEnvironment), {
      brightDataApiKey: 'bright-vendor-key',
    });
    assert.deepEqual(publicSourceCredentials('bluesky', configuredEnvironment), {});
    assert.deepEqual(publicSourceCredentials('rss', configuredEnvironment), {});
  });

  it('uses EnsembleData for supported vendor routes only when Bright Data is unconfigured', () => {
    const withoutBrightData = {
      ...configuredEnvironment,
      BRIGHTDATA_API_KEY: '',
    };

    for (const platform of ['instagram', 'twitter', 'tiktok', 'threads'] as const) {
      assert.deepEqual(publicSourceCredentials(platform, withoutBrightData), {
        ensembleDataToken: 'ensemble-vendor-token',
      });
    }
  });

  it('never exposes an owned or admin credential to pooled adapters', () => {
    const forbiddenKeys = new Set([
      'accessToken',
      'refreshToken',
      'clientKey',
      'clientSecret',
      'bearerToken',
      'selfUserId',
      'igUserId',
      'pageId',
      'appId',
      'appSecret',
      'ppcaApproved',
      'ppcaAccessToken',
      'apiVersion',
      'identifier',
      'appPassword',
    ]);

    for (const platform of PLATFORMS) {
      const keys = Object.keys(publicSourceCredentials(platform, configuredEnvironment));
      assert.equal(
        keys.some((key) => forbiddenKeys.has(key)),
        false,
        platform + ' leaked a private credential field: ' + keys.join(', '),
      );
    }
  });

  it('forces the competitor path even for a legacy owned cursor', () => {
    assert.deepEqual(pooledFetchCursor({
      nextCursor: 'page-2',
      __isOwned: true,
      __legacySecret: 'discard-me',
    }), {
      nextCursor: 'page-2',
      __isOwned: false,
    });
  });
});
