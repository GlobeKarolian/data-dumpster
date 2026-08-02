import * as React from 'react';
import type { MetricRow } from '@/lib/types';
import { StatTile } from '@/components/ui/stat-tile';

export interface RedditAccountGlanceProps {
  focusCompanyId: string | null;
  posts: MetricRow[];
  score: MetricRow[];
  comments: MetricRow[];
  engagementPerPost: MetricRow[];
  color?: string;
}

interface RedditTile {
  metric: 'posts' | 'applause' | 'conversation' | 'engagementPerPost';
  label: string;
  rows: MetricRow[];
  footnote?: React.ReactNode;
}

/**
 * Account-level Reddit metrics use only observations the public user feed
 * exposes. Reddit user profiles have no trustworthy follower denominator, so
 * this row deliberately avoids audience and engagement-rate-by-member tiles.
 */
export function RedditAccountGlance({
  focusCompanyId,
  posts,
  score,
  comments,
  engagementPerPost,
  color,
}: RedditAccountGlanceProps) {
  const tiles: RedditTile[] = [
    { metric: 'posts', label: 'Posts', rows: posts },
    {
      metric: 'applause',
      label: 'Total Score',
      rows: score,
      footnote: 'Reddit’s public score is vote-fuzzed; it is not a literal upvote count.',
    },
    { metric: 'conversation', label: 'Comments', rows: comments },
    {
      metric: 'engagementPerPost',
      label: 'Engagement per Post',
      rows: engagementPerPost,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map(({ metric, label, rows, footnote }) => {
        const row = rows.find((candidate) => candidate.company.id === focusCompanyId);
        const available = row?.available === true;

        return (
          <StatTile
            key={metric}
            metric={metric}
            label={label}
            value={available ? row.value : null}
            previousValue={available && row.previousAvailable ? row.previousValue : null}
            changePct={available ? row.changePct ?? null : null}
            color={color}
            footnote={footnote}
          />
        );
      })}
    </div>
  );
}
