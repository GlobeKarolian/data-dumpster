# AI post tagging

Written 18 August 2026, alongside the first implementation.

## What it does

Every post the collectors bring in is read once by the org's own model and
given tags from the org's taxonomy. When the taxonomy changes — a tag added,
removed, renamed, or its description rewritten because a story shifted — every
post tagged under the old taxonomy becomes stale and is re-read, gradually and
within a spend ceiling, without an operator pressing anything.

## The parts that already existed

This system deliberately completes machinery the schema always described
rather than inventing a parallel one:

- `post_tags.aiPrompt` — "natural-language description used by the AI tagger
  when rule is absent." The column predates the tagger. A tag's aiPrompt IS
  its definition as far as the model is concerned; editing it is how an
  operator re-scopes a tag when the discussion moves.
- `post_tag_assignments.source` — `manual | rule | ai`. The AI writes only
  `ai` rows and never touches the other two. A human's decision outranks the
  model permanently; a rule keeps firing at ingest untouched.
- `post_tag_assignments.confidence` — populated by the model per assignment.
- The durable-queue shape proven by `channel_collection_state`: state rows,
  claim by `next_attempt_at`, settle with an outcome, retries with attempts.

## Tenancy: pooled posts, per-org tags

Posts are pooled across organizations; taxonomies are per-org. The same post
can therefore carry one org's "Clancy trial" tag and another org's "Crime"
tag with no interaction. Tagging state is keyed `(org_id, post_id)` — the
model's read of a post is an org-scoped fact, because the question it answered
("which of THIS org's tags apply?") is org-scoped.

## The taxonomy fingerprint, which is the whole recompute design

`ai_tag_state.taxonomy_fingerprint` is a SHA-256 over the org's AI-eligible
tags: each tag's id, name and aiPrompt, sorted by id. The current fingerprint
is computed at claim time; a state row carrying any other value is stale.

That single comparison replaces every form of invalidation bookkeeping:

- Add a tag → fingerprint moves → every post is stale → all re-read.
- Rewrite one aiPrompt → same.
- Delete a tag → same, and its `ai` assignments are already gone via FK
  cascade.
- Nothing changed → nothing is stale → the cron only reads new posts.

There is no "recompute" button because there is nothing to press: editing the
taxonomy is the trigger, and the queue drains stale posts newest-first until
none remain, at whatever pace the budget allows.

## The queue

`ai_tag_state`: PK `(org_id, post_id)`, `taxonomy_fingerprint`, `model`,
`status` (`queued | running | succeeded | failed`), `attempts`,
`next_attempt_at`, `last_error`, `tagged_at`.

A cron tick (`/api/cron/tag`, every 10 minutes) does, per org that has at
least one aiPrompt tag and a configured model connection:

1. Compute the current fingerprint.
2. Claim up to BATCH posts needing work, newest `posted_at` first: posts of
   companies in the org's landscapes that either have no state row, or a row
   with a different fingerprint, or a retryable failure due. Claiming sets
   `status='running'` and a lease via `next_attempt_at`, using
   `FOR UPDATE SKIP LOCKED` so overlapping ticks cannot double-tag.
3. Send ONE completion per batch: the taxonomy (name + aiPrompt per tag) and
   up to 20 posts (text, platform, type, hashtags, top URLs), with a strict
   JSON schema. Temperature 0. One call for 20 posts is the entire cost story:
   per-post calls would be 20x the spend for the same tokens read.
4. Validate every returned assignment: unknown tag ids are dropped, not
   guessed at; confidences outside [0,1] are clamped; a post the model skipped
   settles `succeeded` with zero assignments (measured "no tags apply" — the
   absence is a result, not a failure).
5. Write in this order, because Neon HTTP has no transactions: delete the
   org's existing `ai` assignments for the claimed posts → insert the new
   `ai` rows → settle state LAST. The state row is the cursor; a crash before
   it re-runs the post idempotently rather than leaving it half-recorded.
6. Meter through `complete()` with `feature: 'post-tagging'`, which lands in
   `ai_usage` like every other surface. The tick stops claiming once the
   org's tagging spend for the day exceeds `AI_TAGGING_DAILY_USD` (default 5;
   env-configurable). A taxonomy edit over a large corpus is therefore a slow,
   bounded wave, not a bill.

## What the model is told, and not told

The prompt contains the tag definitions and the post content. It does not
contain engagement numbers, follower counts, or anything the fact-sheet
discipline exists to protect — tagging is classification, and the one rule
carried over from the numerical surfaces is the same shape: the model may only
choose from ids we gave it, and everything it returns is validated against
that list before a row is written. A hallucinated tag cannot reach the
database.

## Failure behaviour

- Model/provider errors settle `failed` with backoff doubling from 10 minutes,
  and a post stops retrying after 6 consecutive failures until the fingerprint
  next moves (a taxonomy edit re-arms everything).
- A post with no usable text settles `succeeded` with zero assignments; there
  is nothing to read and nothing will change on retry.
- The cron tolerates partial batches: every claimed post settles one way or
  the other before the tick ends, and leases expire so a crashed tick's claims
  return to the pool.

## Not in scope, deliberately

- No automatic drift detection ("these posts look like a new topic"). The
  operator renames and describes tags; the system notices and re-reads. An
  unsupervised topic model deciding the taxonomy would put the model in charge
  of the vocabulary, which is the operator's.
- No per-post UI actions. The Post Tags page continues to manage taxonomy;
  assignments appear on posts as they always have, with `source='ai'` and
  confidence visible.
- No cross-org batching, ever: one org's taxonomy must not appear in another
  org's prompt.
