import type { Platform } from '@/lib/types';
import { platformAudienceNoun } from '@/lib/platform-language';

export interface VerifyWarning {
  code: 'tiny_audience' | 'no_content' | 'not_verified' | 'already_attached' | 'name_mismatch' | 'private';
  message: string;
  /** High means the resolved account is very likely not the intended profile. */
  severity: 'high' | 'medium' | 'low';
}

/**
 * Flag profiles that resolve successfully but still deserve a human look.
 *
 * These checks stay advisory: a small local outlet can legitimately have a tiny
 * audience, while a typo can resolve to a perfectly valid unrelated account.
 */
export function assessProfileMatch(
  profile: {
    handle: string;
    displayName?: string;
    followers?: number;
    meta?: Record<string, unknown>;
  },
  companyName: string,
  alreadyAttached: boolean,
  platform?: Platform,
): VerifyWarning[] {
  const out: VerifyWarning[] = [];
  const followers = profile.followers ?? 0;
  const audience = platform ? platformAudienceNoun(platform).toLowerCase() : 'followers';

  if (followers > 0 && followers < 100) {
    out.push({
      code: 'tiny_audience',
      severity: 'high',
      message: 'This account has only ' + followers.toLocaleString() + ' ' + audience + '. Squatted and '
        + 'abandoned handles look exactly like this. Confirm it is really ' + companyName + '.',
    });
  } else if (followers >= 100 && followers < 1000) {
    out.push({
      code: 'tiny_audience',
      severity: 'medium',
      message: 'Only ' + followers.toLocaleString() + ' ' + audience + '. Plausible for a small outlet, '
        + 'worth a look before saving.',
    });
  }

  const meta = profile.meta ?? {};
  if (meta.isVerified === false && followers > 10000) {
    out.push({
      code: 'not_verified',
      severity: 'low',
      message: 'Not a verified account, despite a sizeable following. Impersonation accounts are common '
        + 'for news brands.',
    });
  }
  if (meta.isPrivate === true) {
    out.push({
      code: 'private',
      severity: 'high',
      message: 'This account is private. Data Dumpster will not be able to read its posts.',
    });
  }

  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const companyTokens = new Set(norm(companyName).split(' ').filter((token) => token.length > 2));
  const profileText = norm((profile.displayName ?? '') + ' ' + profile.handle);
  const overlap = [...companyTokens].some((token) => profileText.includes(token));
  if (companyTokens.size > 0 && !overlap) {
    out.push({
      code: 'name_mismatch',
      severity: 'medium',
      message: 'The account name (' + (profile.displayName ?? profile.handle) + ') shares no words with '
        + companyName + '.',
    });
  }

  if (alreadyAttached) {
    out.push({
      code: 'already_attached',
      severity: 'low',
      message: 'This profile is already attached. Saving will refresh it rather than duplicate it.',
    });
  }

  return out;
}
