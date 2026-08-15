# Storage policy and operating plan

**Scope:** pooled public observations and organization-private product state.
This document describes what is retained, why it is retained, and which parts
of the lifecycle are implemented versus still operational work.

## Current shape

The production database audit on 4 August 2026 found about 263 MB of user
tables. `posts` accounts for about 231 MB, including about 189 MB of TOAST
storage left by large and frequently rewritten historical payloads. This is not
an immediate capacity emergency. The important risks are ambiguous legacy
provenance, high-frequency metric churn, and unbounded audit/history growth.

Public entities are deliberately global:

- one `company` and `channel` represent the same public account everywhere;
- `posts`, public metric snapshots, audience stocks, and posted URLs are
  collected once and reused by every landscape that demands that channel; and
- `landscapes`, membership/demand, tags, dashboards, reports, alerts, model
  activity, and delivery records remain organization-private.

Adding the same brand to another landscape must never create another copy of
its public history or another vendor crawl. The new landscape widens the one
pooled demand only when it asks for an older uncovered window.

## What belongs in Postgres

Retain indefinitely:

- canonical normalized public posts;
- one audience stock per channel and day;
- company/channel identity and landscape demand;
- compact immutable collection receipt headers and source provenance; and
- daily or weekly long-term metric rollups after compaction.

Retain for a bounded period:

- high-resolution post metric snapshots for 30 days;
- daily post metric rollups through 13 months, then weekly rollups;
- verbose ingestion diagnostics for 90 days; and
- completed refresh-job activity/detail for 90 days.

Do not retain by default:

- arbitrary vendor response payloads;
- access tokens, administrator-only fields, or owner analytics in pooled rows;
- full-resolution image or video binaries; or
- repeated metric snapshots whose measured values did not change.

The normalized row is the durable fact. Public media URLs remain source
references, but the product also retains one bounded display thumbnail for a
post in private Vercel Blob storage after it has been recovered. The existing
authenticated/report-capability preview route serves that copy; storage URLs
are never handed to the browser. A small engagement-first sweep protects recent
Facebook posts before signed Meta CDN references expire, while Instagram,
Threads and TikTok posters are retained when their preview proxy resolves them.
Do not archive full social videos by default.

## Source state and receipts

`channel_collection_state` owns the logical demanded window and certified
coverage. `public_channel_source_state` owns each source's mechanics, keyed by
`(channel_id, source_key)`. Bright Data receipts, EnsembleData cursors, and
official API cursors therefore cannot overwrite one another.

A paid Bright Data receipt is resumable work, not an ordinary failure. Its
source, dataset, stage, snapshot id, exact window, and replacement count remain
bound until completion or operator reconciliation. A failed paid stage never
falls through to another vendor and purchases the same work again.

## Indexing and maintenance

The source-state migration also adds the current hot-path indexes:

- `posted_urls(post_id)` for per-post URL reconciliation;
- `ingestion_runs(channel_id, started_at desc)` for the Sources screen; and
- `post_metric_snapshots(captured_at)` for future retention/compaction sweeps.

Regular autovacuum remains appropriate. Do not run `VACUUM FULL`, rewrite the
large posts table, or delete orphaned data without a verified backup and an
explicit maintenance window.

## Remaining release work

The schema and source-state cutover are only the first storage phase. The
following still need implementation and production verification:

1. quarantine or publicly recollect legacy rows whose visibility/source is
   ambiguous, then make every competitive read require `public_comparable`;
2. persist per-field metric availability so an omitted vendor field is null or
   unavailable, never silently interpreted as a measured zero;
3. add unchanged-snapshot suppression and the 30-day/daily/weekly compaction
   job before metric history becomes the dominant storage cost;
4. reconcile ingestion runs left `running` after a worker lease expires;
5. verify the Neon backup/PITR window, create an encrypted logical export of
   irreplaceable normalized facts, and perform a restore drill; and
6. alert on database size, TOAST/dead tuples, row growth, and vendor spend at
   60%, 75%, and 85% of the approved capacity or budget.

The orphan inventory is an operator report, not an automatic deletion queue.
Undemanded channels may hold useful pooled history and must not be erased merely
because no current landscape references them.
