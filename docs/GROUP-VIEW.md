# Group View

**Audience:** the engineer maintaining Group View, and the editor deciding
whether it is a responsible thing for a newsroom to run.

**Shape:** an org-private watchlist of public Facebook groups, collected on the
same durable queue the brand adapters use, surfaced as two reads: what the
groups are discussing, and whose links travel into them.

---

## 1. What it is

A newsroom watches a handful of public Facebook groups the way it already
watches competitor accounts. Group View collects the posts in those groups and
answers two questions an editor actually asks:

- **What are these communities discussing?** Group posts run through the same
  tagging pipeline as everything else, so the topic breakdown is comparable to
  the rest of the product.
- **Whose links travel into them?** Every outbound URL in a group post is
  parsed to its registrable domain and aggregated, with the org's own domains
  marked. This is the distribution question: when a story runs, does it reach
  the places where the community actually talks.

Group View lives under Intelligence in the nav, at `/groups`.

## 2. The one rule specific to groups

Bright Data's Facebook group dataset (`gd_lz11l67o2cb3r0lkj3`, mapped as
`DATASETS.facebookGroupPosts`) returns posts from **public** groups. A
members-only group returns no rows, or a vendor error naming access.

Group View does not try to get around that. A group that returns nothing
collectible settles `ineligible` and is shown to the user as "Private — not
collectible" rather than retried forever. The collector never authenticates as a
member, never joins a group, and holds no per-group credentials. It reads what
is already public, which is the same posture as the rest of the platform.

This is a deliberate product boundary, not a temporary limitation. If a future
requirement needs private-group content, that is a separate decision with its
own review, and it does not belong in this collector.

## 3. Data model

Three tables, added in migration `0031_group_view`:

- **`watched_groups`** — one row per group an org watches: `url`, `name`,
  `area`, `active`. Org-private.
- **`group_posts`** — the collected posts. Full records: `external_id`,
  `posted_at`, `content`, `author_name`, `author_profile_url`, `likes`,
  `comments`, `shares`, `permalink`, the parsed `urls`, and the untouched vendor
  `raw`. Deduplicated by `group_posts_dedupe_idx` on
  `(org_id, group_id, external_id)`.
- **`group_collection_state`** — one row per group: `status`, `outcome`,
  `attempts`, `next_attempt_at`, `resume_snapshot_id`, `last_error`,
  `last_collected_at`. This is the queue.

## 4. Collection

`src/lib/groups/collect.ts` is a straight application of the durable-queue
pattern documented in ARCHITECTURE.md, scoped to one org per tick:

- `claimGroups` claims up to eight due groups with `FOR UPDATE ... SKIP LOCKED`
  and writes a `collecting` lease of eight minutes, so two overlapping ticks
  never collect the same group twice.
- Each claimed group is collected with `scrapeSync` against the group dataset.
  Because `scrapeSync` is trigger-and-poll, a group that outlives its serverless
  invocation raises `PendingSnapshotError`; the collector keeps the snapshot
  receipt and the next tick resumes from it rather than paying Bright Data
  twice.
- `settle` records the outcome. `covered` schedules the next read in six hours;
  `failed` backs off exponentially and stops after six attempts; `ineligible`
  clears `next_attempt_at` so a private group is not retried.

The cron is `/api/cron/groups`, scheduled `20,50 * * * *` in `vercel.json`. It is
not a new collection window in the sense the automatic-refresh fence cares about;
it is pinned in `automatic-refresh.test.ts` alongside the other crons so the
schedule and the test never drift.

Adding a group is an editor action: `POST /api/groups` with a
`facebook.com/groups/…` URL (Zod-validated). The next tick picks it up.

## 5. Identity gating

Group posts are written by named people, not brands. Their `author_name` and
`author_profile_url` are collected and stored, because the raw record is kept
whole, but they are **not displayed by default**.

`groupIdentitiesVisible(role)` in `src/lib/groups/queries.ts` gates display
behind two conditions at once: the viewer is at least an `admin`, **and** the
`GROUP_IDENTITIES_VISIBLE` environment flag is `true`. Absent either, the UI
says identities are collected but not shown. The flag defaults off. Turn it on
only with an editorial reason to see who is posting, not by default.

## 6. Known gap: the discussions panel needs tagging

`group_posts` is a separate table from `posts`. The tagging pipeline reads
`posts`. As shipped, group posts are therefore **not yet tagged**, so
"What groups are discussing" renders its honest empty state explaining that
topics appear once tagging has read the posts. The "Whose links travel" panel
does not depend on tagging and works from the first collection.

Closing the gap is a deliberate follow-up: either extend the tagger to read
`group_posts`, or fold group posts into the tagging queue's input. Until then the
distribution view is the live half of the tool, and the discussions view is
wired and waiting.
