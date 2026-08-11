# Data Dumpster build contract

Read this before changing code. `src/db/schema.ts` is the data-model source of
truth; this file records the invariants a green build alone cannot protect.

## Product contract

Data Dumpster is Boston Globe Media's internal competitive social-intelligence
platform. A landscape is one focus company plus a comparison set. Every
analytical screen answers: how did the focus company compare with that set on a
defined metric, in this exact window, versus the previous equal-length window?

The product earns trust through three properties:

1. The organization chooses and pays its own model provider.
2. Metrics have one code-owned definition, explicit availability and auditable
   provenance.
3. Newsroom workflows such as desk tags, posted URLs, reports and alerts are
   first-class.

Owners and admins can access every landscape in their organization. Editors
and viewers can access only landscapes explicitly listed in
`user_landscape_access`; a missing grant is treated as not found rather than as
a discoverable forbidden resource. Existing restricted users are backfilled to
their current landscapes when the table is introduced. A restricted user who
creates a landscape receives its first grant automatically. New restricted
accounts otherwise begin with no landscape access until an admin assigns it.

## Release gate

The current schema is designed to pool public observations but does not yet
isolate all owned-native data. Global `channels.isOwned`, cursors, collection
state and raw payloads remain legacy mixed-mode structures. Phase 0 containment
now forces pooled work through allowlisted deployment public sources and rejects
owned-mode onboarding, so new normal collection cannot select an organization's
owner credential. Historical rows still require contamination inventory,
quarantine and public re-collection. Do not call the system safely multi-tenant
or expand owned-insight use until `docs/OWNED-DATA-ISOLATION.md` is complete and
its cross-tenant acceptance suite passes.

Public competitive metrics must use only `public_comparable` observations.
Owned saves, reach, impressions, clicks, native rates, signed media and raw
payloads belong in organization-private storage behind a verified channel and
credential binding. Public sharing and competitive AI may never consume them.

## Absolute rules

- TypeScript stays strict. Run `./node_modules/.bin/tsc --noEmit`; do not use
  `npx tsc` in this repository.
- Read the relevant guide in `node_modules/next/dist/docs/` before changing a
  Next.js API or convention.
- Never sum audience snapshots. Audience is a stock and every audience read
  goes through `src/lib/metrics/` helpers that select a per-channel snapshot.
- `changePct` returns `null` when the baseline is zero.
- Missing is distinct from measured zero. Carry availability to the UI, exports
  and fact sheets; exclude an unmeasured row from comparison averages.
- Every AI number comes from the exact code-computed fact sheet supplied to the
  model and passes deterministic citation and semantic verification before it
  is saved or rendered.
- No mock observations enter production paths. Seed data may create workspace
  shape but never metrics.
- No RSS ingestion. It was retired because posts with no comparable engagement
  or audience distorted the product's averages.
- Never commit secrets. Add every new environment variable to `.env.example`
  and preserve an existing `.env.local`.
- Apply every committed database migration before deploying application code
  that reads its schema. A rolling deployment is not permission to reverse this
  order.

## Canonical metric vocabulary

- **applause**: likes, reactions, favorites, hearts, upvotes
- **conversation**: comments, replies
- **amplification**: shares, retweets, reposts, quotes
- **saves**: saves or bookmarks where measured
- **views**: video or impression views where measured
- **engagementTotal**: applause + conversation + amplification + saves
- **engagementPerPost**: engagementTotal / posts
- **engagementRateByFollower**: mean of each measurable post's
  engagementTotal / followersAtPost
- **engagementRateByView**: engagementTotal / measured views
- **audienceNetChange**: end stock - start stock
- **shareOfVoice**: company posts / all landscape posts
- **shareOfEngagement**: company engagementTotal / landscape engagementTotal

`src/lib/metrics/definitions.ts` owns the labels, formulas and caveats. The
follower-rate implementation is centralized in
`src/lib/metrics/follower-rate.ts`: posts without a positive
`followersAtPost` are excluded from both numerator and count, and the result is
`null` when no post is measurable. Never replace this with pooled engagement
divided by pooled followers.

Some adapters normalize a platform field that was not exposed to a storage-level
zero. That raw value alone is not evidence of measured zero. Product reads must
consult coverage and metric availability before rendering, averaging or sending
the value to AI.

## Measurement boundary

Measurement SQL is deliberately contained in these modules:

- `src/lib/metrics/queries.ts`: core metrics, post and URL exploration, fact
  sheets and report inputs;
- `src/lib/metrics/content-analysis.ts`: Content Analysis;
- `src/lib/metrics/ingestion-coverage.ts`: selected-window source coverage;
- `src/lib/metrics/daily-coverage.ts`: audience-day health and recovery.

Server Components call these modules directly. Route handlers are thin,
Zod-validated wrappers for client interactions and external consumers. Every
query resolves a landscape guarded by both organization and user access first;
`companies.orgId` is attribution for a pooled company, not a tenancy boundary.

All report and analytics dates use explicit IANA zones. Product metric windows
are pinned to `America/New_York`; report schedules store their own IANA zone.
Never use ambient process-local date methods for a product boundary.

## Ingestion contract

Every adapter implements `ChannelAdapter` and must return an explicit
`FetchResult` completeness state:

- `{ hasMore: false, exhaustive: true }` certifies the attempted window;
- `{ hasMore: true, exhaustive: false, incompleteReason }` means a durable
  continuation exists; and
- `{ hasMore: false, exhaustive: false, incompleteReason }` means the source
  returned useful but terminally limited data.

Omission never means complete. The scheduler persists one of five outcomes:
`certified_complete`, `continuation`, `terminal_source_limitation`,
`retryable_operational_failure`, or `permanent_failure`. Only continuations run
immediately; operational failures back off; terminal source limitations and
permanent failures stop until a fresh or forced request. A source cap or selected
feed must never become an infinite paid retry loop.

Public account identity is global. `channels.identity_key` is the normalized
platform/handle fallback, and a non-null platform `external_id` is unique within
that platform. Each organization-private landscape records its own requested
window in `landscape_channel_demands`; the scheduler pools those rows to one
global state row, one source request and one lease per channel. A channel with no
live demand cannot be claimed. Adding the same company to another landscape
reuses stored observations and sufficiently fresh coverage; a wider unmet
window creates one widened pooled job, not one crawl per landscape.

The fetched platform id is a pre-write gate. The runner normalizes and claims it
before any audience, post, snapshot, URL, tag or payload write. A blank id, a
changed id for an already bound row, or an id claimed by another pooled row is a
`permanent_failure` for operator reconciliation. It writes no observations and
never guesses how to merge histories. An operational database error while
checking the claim remains retryable.

The only pre-identity persistence exception is an empty, still-running Bright
Data snapshot from an explicitly implemented paid stage. Facebook, Instagram,
TikTok, X and Threads bind each receipt to its source, dataset, stage and exact
window and expose the snapshot id as a non-empty generic continuation cursor.
The next run validates all of those fields and polls that snapshot instead of
triggering another paid job. A multi-stage adapter may carry a profile identity
that the source already returned, but no audience or post observation lands
until the stable-id gate passes. A receipt older than 24 hours may start at most
one automatic replacement, with a durable warning and counter in the cursor. If
that replacement also remains pending, the adapter makes one final free poll of
the saved receipt and then returns a non-retryable operator-review failure. It
never starts a second automatic replacement. If the database cannot durably
save a newly returned paid receipt, the run also fails permanently for operator
review; automatic retry cannot prove that it would not purchase duplicate work.

The durable Postgres queue:

- requests 90 days for an uncollected profile;
- re-reads a two-day overlap for mutable engagement;
- considers settled profiles fresh for twelve hours;
- claims rows with `FOR UPDATE SKIP LOCKED` and a six-minute lease;
- runs up to ten network-bound workers while per-platform rate gates remain in
  force; and
- tracks attempted freshness separately from certified coverage.

The shell exposes automatic collection status to ordinary users. Two named data
operators (`matt.karolian@globe.com` and `matt@boston.com`) also receive an
explicit manual-refresh control. New freshness windows open at 00:00 and 12:00
UTC. Offset recovery
workers may resume continuations, paid receipts and eligible retries already in
the durable queue, but they never reconcile fresh profiles into another window.
The browser can monitor an active `refresh_jobs` coordinator and may be closed
without stopping collection. The authenticated `POST /api/ingest/run` is denied
to every other identity and lets those two operators deliberately bypass the
twelve-hour freshness fence. Landscape authorization, paid-endpoint rate limits,
pooled channel leases and one active coordinator per landscape still apply, so
an overlapping manual request attaches to existing work instead of buying a
duplicate crawl. Terminal counters and activity are frozen because the pooled
channel queue continues changing after a coordinator finishes.

Neon's HTTP driver does not provide a multi-statement transaction. The write
order is load-bearing: stable platform identity first, audience second, posts
third, metric snapshots fourth, then posted URLs and organization-private tag
assignments, with the channel cursor and watermark last. Posts and most
dependents are idempotent upserts.
Posted URLs are a scoped delete-then-insert and briefly disappear between those
statements; a failure leaves the cursor unchanged so the next run repairs them.
The audit row is best effort and must not hide the primary outcome.

The one-shot CLI is another queue dispatcher, not a direct runner. Real runs
register each selected channel's demands across its landscapes and claim only
through the global lease. `--dry-run` performs only the read-only target query:
it registers no demand, imports no writable queue path, makes no vendor call and
writes nothing. An untracked channel is reported but cannot be crawled until it
belongs to a landscape.

Public company and channel deletion is disabled in product routes because it
would cascade pooled history. Removing landscape membership removes that
landscape's demand while preserving the global identity and observations for
reuse. `channels.active` is only a global admin quarantine, requires explicit
global scope, and cannot be changed through one organization while the company
is shared with another.

Before mapping a vendor response, call the real endpoint and inspect a sanitized
payload. A documented field name is not a contract until a fixture and mapper
test prove it.

## AI contract

Ask and Brief receive only a typed fact sheet produced by the metric layer. The
model has no database tools and performs no trusted arithmetic.

- Ask recomputes the exact selected scope, compares its SHA-256 fingerprint with
  the fact sheet displayed by the browser, and returns 409 before model spend if
  the data changed.
- The verifier checks every numeric claim, full array-indexed citation path,
  metric subject and printed-percent guardrail.
- Brief verification also requires every fact-sheet caveat.
- One repair turn is allowed. A second failure returns 422; the prose is not
  saved or rendered. Historical briefs without an explicit passing verdict are
  withheld.

## Design language

Dense, quiet and fast, closer to Linear than a marketing site. Neutral zinc and
slate surfaces, Globe red (`#C8102E`) as the restrained accent, platform colors
only for data, right-aligned tabular numbers, explicit blanks and caveats, dark
mode throughout, and no emoji in the product UI.

## Required verification

Run from `/Users/mkarolian/Developer/pressbox`:

    ./node_modules/.bin/tsc --noEmit
    npm run lint
    npm test
    npm run build
    ./node_modules/.bin/drizzle-kit check

If the shell has `NODE_ENV=production`, unset it first so npm does not omit the
test and build toolchain.
