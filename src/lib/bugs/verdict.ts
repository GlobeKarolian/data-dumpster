/**
 * Pure verdict for one reported post. Kept free of the database so the
 * wording and the branch order are tested directly.
 */

export interface TrackedChannelFacts {
  channelId: string;
  company: string;
  handle: string;
  active: boolean;
  status: string | null;
  outcome: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  newestPostAt: string | null;
  postsLast14Days: number;
}

export type PostVerdict =
  | 'stored'
  | 'account_unknown'
  | 'account_not_tracked'
  | 'account_paused'
  | 'collection_overdue'
  | 'collection_silent'
  | 'skipped_in_gap'
  | 'newer_than_last_collection';

const DAY = 864e5;

function day(isoText: string): string {
  return isoText.slice(0, 10);
}

function hoursAgo(isoText: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - new Date(isoText).getTime()) / 36e5));
}

export function postVerdict(input: {
  platformLabel: string;
  handle: string | null;
  postedOn: string | null;
  stored: Array<{ company: string; handle: string; postedAt: string }>;
  channels: TrackedChannelFacts[];
  now: Date;
}): { verdict: PostVerdict; text: string } {
  const { platformLabel, handle, postedOn, stored, channels, now } = input;

  if (stored.length > 0) {
    const where = stored.map((s) => s.company + ' (@' + s.handle + ')').join(', ');
    return {
      verdict: 'stored',
      text: 'This post is in Data Dumpster under ' + where + ', posted ' + day(stored[0].postedAt)
        + '. If the reporter cannot see it, check the landscape, date range, account filter or collab display.',
    };
  }

  if (!handle) {
    return {
      verdict: 'account_unknown',
      text: 'This ' + platformLabel + ' post is not stored, and the link does not name the account, so the owning profile could not be checked.',
    };
  }

  if (channels.length === 0) {
    return {
      verdict: 'account_not_tracked',
      text: '@' + handle + ' on ' + platformLabel + ' is not a tracked profile, so its posts are never collected. Add the profile under Social Profiles if it should be.',
    };
  }

  const active = channels.filter((c) => c.active);
  if (active.length === 0) {
    return {
      verdict: 'account_paused',
      text: '@' + handle + ' on ' + platformLabel + ' (' + channels[0].company + ') is tracked but paused, so new posts are not collected.',
    };
  }

  const ch = active[0];
  const who = '@' + ch.handle + ' on ' + platformLabel + ' (' + ch.company + ')';
  const errorNote = ch.lastError ? ' Last error: ' + ch.lastError.slice(0, 200) : '';

  if (!ch.lastAttemptAt || now.getTime() - new Date(ch.lastAttemptAt).getTime() > DAY) {
    return {
      verdict: 'collection_overdue',
      text: who + ' is tracked but has not been collected '
        + (ch.lastAttemptAt ? 'since ' + day(ch.lastAttemptAt) : 'yet')
        + '. The post is missing because collection is behind.' + errorNote,
    };
  }

  const newest = ch.newestPostAt ? new Date(ch.newestPostAt) : null;
  const postedTime = postedOn ? new Date(postedOn + 'T23:59:59Z') : null;

  // Collection keeps running, but nothing new has been stored for days. This
  // is a source or mapping failure, not a delay that the next run will fix.
  const staleNewest = newest !== null && now.getTime() - newest.getTime() > 3 * DAY;
  if (ch.postsLast14Days === 0 || staleNewest) {
    return {
      verdict: 'collection_silent',
      text: who + ' was collected ' + hoursAgo(ch.lastAttemptAt, now) + ' hours ago, but '
        + (newest ? 'its newest stored post is from ' + day(ch.newestPostAt!) : 'it has no stored posts')
        + (postedOn ? ', before this post from ' + postedOn : '')
        + '. Collection runs but the source returns nothing newer for this account. This needs an engineer.' + errorNote,
    };
  }

  if (postedTime && newest && postedTime.getTime() < newest.getTime()) {
    return {
      verdict: 'skipped_in_gap',
      text: who + ' is collecting (newest stored post: ' + day(ch.newestPostAt!) + '), but this post from ' + postedOn
        + ' was skipped. The source returned a partial feed for that window. This needs an engineer.' + errorNote,
    };
  }

  if (postedTime && new Date(ch.lastAttemptAt).getTime() < new Date(postedOn + 'T00:00:00Z').getTime()) {
    return {
      verdict: 'newer_than_last_collection',
      text: 'This post from ' + postedOn + ' is newer than the last collection of ' + who + ' on '
        + day(ch.lastAttemptAt) + '. It should appear after the next scheduled run.',
    };
  }

  return {
    verdict: 'skipped_in_gap',
    text: who + ' is collecting (' + ch.postsLast14Days + ' posts in the last 14 days, newest '
      + (ch.newestPostAt ? day(ch.newestPostAt) : 'unknown') + '), but this post is not stored. '
      + 'The source likely returned a partial feed. This needs an engineer.' + errorNote,
  };
}
