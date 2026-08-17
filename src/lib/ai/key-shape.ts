/**
 * Catch a key pasted into the wrong provider.
 *
 * This is not security, it is ergonomics. An OpenAI key saved against an
 * Anthropic connection stores fine, encrypts fine, and then fails at the only
 * moment that matters with "invalid x-api-key" -- which reads as "your key is
 * bad" rather than "your key is in the wrong slot". That cost real debugging
 * time during setup, and the shape of a key is enough to tell the difference
 * before anything is written.
 *
 * Advisory, never blocking. Providers change their prefixes and self-hosted
 * gateways issue whatever they like, so a mismatch is a warning the user can
 * override, not a validation error.
 */
import type { ModelProviderId } from './types';

const EXPECTED: Partial<Record<ModelProviderId, { test: RegExp; looksLike: string }>> = {
  anthropic: { test: /^sk-ant-/, looksLike: 'sk-ant-...' },
  openai: { test: /^sk-/, looksLike: 'sk-... or sk-proj-...' },
  openrouter: { test: /^sk-or-/, looksLike: 'sk-or-v1-...' },
  google: { test: /^AIza/, looksLike: 'AIza...' },
};

/** Which provider does this key most plausibly belong to? */
export function guessProvider(key: string): ModelProviderId | null {
  // Prefixed sk- variants must be tested before the bare sk- catch-all, or
  // every Anthropic and OpenRouter key reads as an OpenAI key.
  if (/^sk-ant-/.test(key)) return 'anthropic';
  if (/^sk-or-/.test(key)) return 'openrouter';
  if (/^AIza/.test(key)) return 'google';
  if (/^sk-/.test(key)) return 'openai';
  return null;
}

export function checkKeyShape(provider: ModelProviderId, key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return null;

  if (/[•●*]/.test(trimmed)) {
    return 'That looks like a masked value rather than a real key. Paste the full key again.';
  }
  if (/\s/.test(trimmed)) {
    return 'That key contains a space or line break, which usually means it was copied with '
      + 'surrounding text. Paste just the key.';
  }

  const expected = EXPECTED[provider];
  if (!expected || expected.test.test(trimmed)) return null;

  const guess = guessProvider(trimmed);
  if (guess && guess !== provider) {
    return 'This looks like a ' + guess + ' key, but the connection is set to ' + provider
      + '. Sending it will fail with an authentication error. Change the provider, or paste a '
      + provider + ' key (' + expected.looksLike + ').';
  }
  return 'A ' + provider + ' key normally starts with ' + expected.looksLike
    + '. Double check this is the right key before saving.';
}
