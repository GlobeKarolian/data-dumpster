export const POST_COLUMN_OPTIONS = [
  { id: 'postedAt', label: 'Posted date', group: 'Post details' },
  { id: 'text', label: 'Post content', group: 'Post details' },
  { id: 'engagementTotal', label: 'Total engagement', group: 'Performance' },
  { id: 'followersAtPost', label: 'Followers at post', group: 'Performance' },
  { id: 'engagementRateByFollower', label: 'Engagement rate by follower', group: 'Performance' },
  { id: 'type', label: 'Post type', group: 'Post details' },
  { id: 'views', label: 'Views', group: 'Performance' },
  { id: 'company', label: 'Company', group: 'Post details' },
  { id: 'platform', label: 'Channel', group: 'Post details' },
  { id: 'applause', label: 'Applause', group: 'Performance' },
  { id: 'conversation', label: 'Conversation', group: 'Performance' },
  { id: 'amplification', label: 'Amplification', group: 'Performance' },
  { id: 'saves', label: 'Saves', group: 'Performance' },
  { id: 'link', label: 'Original post', group: 'Post details' },
] as const;

export type PostColumnId = (typeof POST_COLUMN_OPTIONS)[number]['id'];

export const DEFAULT_POST_COLUMNS: readonly PostColumnId[] = [
  'postedAt',
  'text',
  'engagementTotal',
  'followersAtPost',
  'engagementRateByFollower',
  'type',
  'views',
];

export const REDDIT_POST_COLUMNS: readonly PostColumnId[] = [
  'postedAt',
  'text',
  'engagementTotal',
  'applause',
  'conversation',
  'amplification',
  'type',
];

const POST_COLUMN_IDS = new Set<string>(POST_COLUMN_OPTIONS.map((column) => column.id));

export function isPostColumnId(value: string): value is PostColumnId {
  return POST_COLUMN_IDS.has(value);
}

/** Only an explicit Reddit-only filter changes the default table shape. */
export function defaultPostColumnsForPlatforms(
  platforms: readonly string[],
): readonly PostColumnId[] {
  return platforms.length === 1 && platforms[0] === 'reddit'
    ? REDDIT_POST_COLUMNS
    : DEFAULT_POST_COLUMNS;
}
