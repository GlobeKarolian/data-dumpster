/**
 * RETIRED: channel history must never be merged from company + platform alone.
 *
 * A company can legitimately operate several accounts on the same platform.
 * The old version of this script treated every such pair as a duplicate, moved
 * some posts, deleted the rest, and then deleted a channel and its audience
 * history. That heuristic is incompatible with the pooled identity model and
 * is intentionally replaced by a hard stop.
 *
 * Use `npm run db:audit-channel-identities` for a read-only identity audit. Any
 * real reconciliation must start from an explicit operator-approved mapping of
 * stable platform IDs and include a backup and migration written for those exact
 * channel IDs. There is no safe generic destructive command.
 */

throw new Error(
  'scripts/dedupe-channels.ts is retired because company + platform is not a channel identity. '
    + 'Run npm run db:audit-channel-identities instead; reconcile confirmed duplicates with an '
    + 'explicit reviewed migration.',
);
