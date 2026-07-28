# Pressbox architecture

**Audience:** an engineer who will maintain this, or a CTO deciding whether it is
maintainable. Every claim here is checkable by reading the file named next to it.

**Shape in one sentence:** a Next.js 16 application on Vercel, a single Postgres
database, eight platform adapters behind one interface, a metric layer that every
read goes through, and a model abstraction that never holds a key it did not
decrypt three lines earlier.

183 TypeScript files, roughly 26,400 lines under "src". No state manager, no
data-fetching library, no component kit, no message queue, no cache tier. Each of
those absences is a decision and most of them are reversible.

---

## 1. Data flow, end to end

                         PLATFORM APIs
       bluesky   youtube   rss   x   meta   tiktok   linkedin
          |         |       |    |     |       |        |
          +---------+-------+----+-----+-------+--------+
                              |
                    +---------v----------+
                    |  lib/adapters/*.ts |   one file per platform
                    |  fetch + normalize |   ChannelAdapter interface
                    +---------+----------+
                              |  NormalizedPost, NormalizedAudience
                    +---------v----------+
                    | adapters/runner.ts |   idempotent upserts, chunked
                    |  concurrency 4     |   per-channel failure isolation
                    |  rate budget       |   writes ingestion_runs
                    +---------+----------+
                              |
    +-------------------------v--------------------------------+
    |                      POSTGRES                            |
    |  posts (latest metrics denormalized)                     |
    |  post_metric_snapshots (append-only time series)         |
    |  audience_snapshots (one row per channel per day)        |
    |  posted_urls, post_tag_assignments                       |
    |  companies, channels, landscapes, landscape_companies    |
    |  briefs, dashboards, alert_rules, alert_events           |
    |  platform_credentials, model_connections, ai_usage       |
    +-------------------------+--------------------------------+
                              |
                    +---------v----------+
                    | lib/metrics/       |   contract.ts is the interface
                    |   queries.ts       |   queries.ts is the only SQL
                    |   definitions.ts   |   definitions.ts is the dictionary
                    +----+----------+----+
                         |          |
          direct call    |          |    direct call
          (no HTTP)      |          |    (no HTTP)
                         |          |
        +----------------v--+    +--v-------------------+
        | Server Components |    | lib/ai/brief.ts      |
        | app/(app)/*/page  |    | getFactSheet -> model|
        +----------+--------+    +--+-------------------+
                   |                |
        +----------v--------+    +--v-------------------+
        | Client components |    | lib/ai/verify.ts     |
        | fetch /api/*      |    | deterministic check  |
        +----------+--------+    +--+-------------------+
                   |                |
        +----------v----------------v-------------------+
        |  app/api/*  Zod-validated wrappers over the   |
        |  same metric functions. Not an internal hop.  |
        +-----------------------------------------------+

The important property of this diagram is that there is exactly one path from a
number in the database to a number on a screen, and it goes through
"src/lib/metrics/queries.ts". Nothing else in the application writes SQL against
the measurement tables. That is what makes the metric dictionary enforceable
rather than aspirational.

---

## 2. Why Postgres, and why this schema

### Why one relational database

The workload is a few million rows, joins across six tables, and time-windowed
aggregation with a comparison period. That is the exact shape Postgres has been
good at for thirty years. A time-series database would handle the metric history
better and the entity graph worse; a document store would handle the raw platform
payloads better and every leaderboard worse. One Postgres is the correct answer
until the scaling numbers in section 6 say otherwise, and the schema is written so
that the fix at that point is materialised rollups rather than a rewrite.

Drizzle rather than Prisma because the schema file is the source of truth and
reads like SQL, there is no separate generation step in the deploy, and the
queries in "queries.ts" need window functions and lateral joins that an ORM query
builder tends to fight.

### Stock versus flow: the distinction the schema is built around

This is the design decision that most affects whether the numbers are right.

**Audience is a stock.** Followers are a level, measured at a point in time. The
schema stores one row per channel per day in "audience_snapshots", with a
composite primary key on (channelId, day). Re-running ingestion for a day
overwrites that day rather than adding to it. Widening a date range therefore
changes which day the snapshot is read from, and never changes the magnitude.
This is the single most common way social dashboards mislead people, and the
metric dictionary carries the caveat in the tooltip: "Audience is a stock, not a
flow."

Audience net change and growth rate are computed as end-minus-start against that
daily series, which means they are well defined for any window and honest about
negative values. Platforms purge bot accounts and audiences do shrink.

**Post engagement is a flow that keeps flowing.** A post published on Monday
keeps collecting likes through Thursday. If Pressbox recorded engagement once at
first sight, every velocity curve in the product would be wrong. So there are two
tables and they do different jobs.

"post_metric_snapshots" is append-only, keyed on (postId, capturedAt). It is the
history. Every refresh writes a new row, and a retry inside the same run
overwrites rather than duplicates because capturedAt is the run's timestamp, not
the current clock. This is what makes "how fast did this post accumulate" a real
question with a real answer.

"posts" carries a denormalised copy of the latest snapshot in its own columns
(applause, conversation, amplification, saves, views, engagementTotal,
engagementRateByFollower). Every read path in the product wants the current
number, and making the leaderboard join a history table with a correlated
"latest" subquery would be the dominant cost in every query in the system. The
denormalisation is a deliberate read optimisation, and it is safe because the
runner writes both in the same operation and the history table is the record of
truth if they ever disagree.

"posts.followersAtPost" is stored rather than joined, for the same reason and one
more: engagement rate by follower has to divide by the follower count at the time
the post ran, not the count today. Storing it makes leaderboards cheap and makes
historical rates stable when a channel's audience later changes.

"posts.raw" holds the original platform payload. It costs storage and it buys the
ability to reprocess a normalisation bug without re-fetching, which on a metered
API is the difference between a bug fix and a budget request.

### Multi-tenancy from the first migration

Everything hangs off an "orgs" row. This was not speculative generality. Boston
Globe Media runs multiple brands (the Globe, Boston.com, STAT), each of which has
a different competitive set and a different social team, and the alternative to
org scoping on day one is three forks by month six. The cost is one join column
on most tables and a scope check in "src/lib/session.ts" that every handler calls.

### Landscapes are a join table, not a column

"landscape_companies" is many-to-many with a sort order. A company appears in
several landscapes, and the same company means different things in each. The
focus company lives on the landscape, not on the company, because "us" is a
point of view rather than a property.

---

## 3. Why Server Components read the query layer directly

A page in "src/app/(app)" imports a function from "src/lib/metrics/queries.ts"
and calls it. It does not fetch its own API route.

The reason is that a Server Component already runs on the server, next to the
database. Making it issue an HTTP request to a route handler in the same
deployment adds a serialization pass, a network round trip, a second cold start,
a second auth check, and a class of bug where the page and the API disagree about
the shape of a response. It buys nothing, because there is no client on the other
end of that call.

The API routes still exist, and they are not dead code. They serve three real
consumers: client components that need to refetch on a filter change without a
full navigation, the CSV export path, and anything outside the app that wants
Pressbox numbers. They are thin. Each one validates its input with Zod, resolves
the org scope from the session, and calls the identical function the Server
Component calls. The contract they share is "src/lib/metrics/contract.ts", which
is types only, so a signature change breaks the build in both places at once.

The practical rule: if a screen renders on first load, it is a Server Component
reading queries.ts. If a control changes data without navigating, that control
calls an API route.

---

## 4. Ingestion, scheduling, and rate limits

Three cron jobs, declared in "vercel.json", with reasoning in "docs/CRONS.md".

    /api/cron/ingest    every 3 hours       maxDuration 300s
    /api/cron/alerts    hourly at :20       maxDuration 120s
    /api/cron/brief     Mondays 06:00 UTC   maxDuration 300s

maxDuration is route segment config in each route file rather than a glob in
"vercel.json", because route segment config is authoritative on Vercel, it lives
next to the runtime it describes, and a stale glob fails the whole deploy.

All three verify an "Authorization: Bearer $CRON_SECRET" header in constant time
and fail closed when CRON_SECRET is unset. All three accept GET, which is what
Vercel Cron sends, and POST, which is what a human reaches for.

### What a run actually does

The runner picks active channels that have an adapter and usable credentials,
stalest first, and processes them four at a time. For each channel it computes a
window, calls the adapter, and lands the result.

The window is the interesting part. A channel with no ingest history reaches back
30 days. A channel with history starts at last_ingested_at minus a two-day
refresh overlap. That overlap exists because engagement is not immutable, and
starting strictly at the high-water mark would freeze every post's metrics at the
moment of first sight.

**The refresh overlap is the largest cost dial in the system.** On the open
platforms it is free. On metered X it is directly proportional to spend: at
roughly 0.005 dollars per post read, a landscape of a dozen X accounts costs
about 45 dollars a month with no refresh, about 180 with a three-day window, and
about 1,350 if you naively re-read 30 days daily. It is currently a constant in
"runner.ts" and it should be a per-platform setting before this is in production
against a paid API. That is the first line item in the Next list in the PRD.

### Rate limits

Three mechanisms, because the platforms use three different models.

**A reservation budget in the runner.** Each channel run reserves an estimated
four API calls before starting and waits up to 60 seconds for budget. A channel
that cannot get budget is deferred rather than failed, so a quota crunch delays
data instead of losing it.

**Adapter-level economy.** The X adapter keeps a since_id high-water mark on the
channel cursor, excludes retweets, and caps pages. Each of those is money. The
RSS adapter uses conditional GET, so an unchanged feed costs a 304. The YouTube
adapter batches video ids, which is why a channel refresh costs about three quota
units per fifty videos against a 10,000 unit daily allowance.

**Honest reporting.** Every run writes an "ingestion_runs" row with posts
upserted, snapshots upserted, API calls made, status, and error text. That table
is how you answer "what did this cost" and "why is this competitor stale" without
guessing.

### Idempotence, and the constraint that forced it

The Neon HTTP driver has no multi-statement transactions. Each statement is its
own HTTP round trip, so "db.transaction" is unavailable, which rules out
delete-then-insert as an atomic pattern and rules out wrapping a channel's writes
in a rollback boundary.

The design response is ordering plus upserts. Posts land first, then everything
that references them, and every dependent write is itself an upsert keyed on
something the platform owns (channelId plus externalId for posts, channelId plus
day for audience, postId plus capturedAt for snapshots). A partial failure leaves
a consistent-if-incomplete picture that the next run repairs. Cron overlaps,
humans clicking refresh, and mid-run crashes all become non-events.

Two more constraints are baked in. Postgres binds at most 65,535 parameters per
statement, so every batch is chunked by column count rather than by a guessed row
count, with a conservative ceiling of 8,000 binds and 500 rows. And one bad
channel must never take down the batch: failures are caught per channel, written
to "ingestion_runs", and reported in the summary, because a newsroom watching
fourteen competitors cannot lose the night to one expired Instagram token.

---

## 5. The AI path, and where the seams are

### The brief loop

    getFactSheet()  ---------------------------------+
      9 parallel SQL aggregations                    |
      leaderboards, focus summary, top posts,        |
      tag + post-type performance, notable URLs,     |
      anomalies, coverage, caveats                   |
                                                     v
                                            +------------------+
                                            |   FactSheet      |
                                            |  (typed, stored) |
                                            +--------+---------+
                                                     |
                            renderFactSheet(): JSON  |  + a flat NUMBER INDEX
                            of every value with its  |    "facts.a.b[0].c = 41208"
                            exact citable path       |
                                                     v
                                            +------------------+
                                            |   MODEL          |
                                            | narrates only.   |
                                            | may not compute. |
                                            +--------+---------+
                                                     | markdown with
                                                     | [facts.path] citations
                                                     v
                                            +------------------+
                                            | verifyBrief()    |
                                            | no model. pure   |
                                            | string + number  |
                                            +--------+---------+
                                                     |
                                    ok? ---- yes ----+---- no ----+
                                     |                            |
                                     v                            v
                            store markdown +            one repair turn with
                            factSheet +                 the exact failing
                            verification                strings, then keep
                            in briefs.facts             whichever draft scored
                                                        higher. Never a loop.

The model never queries anything. It receives a fact sheet that Pressbox's own
SQL computed and sanity-checked, and it may only restate values that appear in
it. It may not add, divide, average, project, or annualise. If a number is not in
the sheet, the correct output is a sentence without a number.

"verify.ts" then checks mechanically whether it obeyed. It extracts every number
in the markdown, normalises it (1.2M, 45k, 27.3%, 41,208), strips things that
contain digits but are not claims (dates, clock times, years, code, URLs), and
matches each against an index of every number in the fact sheet. Tolerance is
derived from how precisely the number was written: someone who writes 1.2M has
claimed the value is in [1.15M, 1.25M] and nothing more. It also flags any
printed percent change above 1000 percent, and checks that every string in
facts.caveats survived into the text by distinctive-word overlap.

The verdict is stored in the same row as the brief. Months later, anyone can see
not just what the model said but what was verified at the time it said it.

### Seam one: adding a platform

Write "src/lib/adapters/<platform>.ts" implementing "ChannelAdapter" from
"types.ts": an id, a display name, accessNotes, a worksUnauthenticated flag, a
credential requirement list, and fetch functions returning NormalizedPost and
NormalizedAudience. Add one line to the map in "registry.ts". Add the platform to
the "platform" pgEnum if it is genuinely new.

Nothing else changes. The runner, the settings UI, the channel picker and the
navigation all read through "getAdapter", "listAdapters" and
"listUnauthenticatedAdapters". The registry map is deliberately a Partial record
rather than a complete one, because the schema can store platforms that no
adapter can read, and the type system should force every caller to handle that
rather than pretend the gap does not exist.

### Seam two: adding a model provider

Write "src/lib/ai/providers/<name>.ts" implementing "ModelProvider" from
"ai/types.ts": an id, a display name, whether baseUrl is required, whether a key
is needed, suggested models with their per-million-token prices, a docs link, and
a "complete" function. Add one entry to "PROVIDERS" in "ai/registry.ts" and one
value to the model_provider pgEnum.

The Settings picker renders straight off "listProviders()", so there is no UI
work. Because "PROVIDERS" is a complete Record over the ModelProviderId union,
TypeScript fails the build the moment an id is added without an implementation.
Bedrock is in the table today and deliberately unimplemented, failing with a
message that names the workaround (an OpenAI-compatible gateway in front of it),
because a provider that is silently missing looks like a bug and a provider that
explains itself is documentation.

---

## 6. Failure modes

Everything here is a thing that will happen, not a thing that might.

| Failure | What happens | Why that is the right behaviour |
|---|---|---|
| Platform API returns 5xx | Adapter throws a retryable AdapterError. That channel's run is marked failed in ingestion_runs. The other channels finish. | Three hours later the next run reaches back past the failure window and repairs it. No operator action. |
| Token expired or revoked (401/403) | Non-retryable AdapterError. The channel fails with a readable reason, visible in Settings, Sources. | Retrying a 401 three times is a waste of quota and hides the actual fix. |
| ENCRYPTION_KEY rotated, credentials undecryptable | The runner skips that credential with a warning and continues the batch. | Losing one platform is recoverable. Failing the whole night because one secret is unreadable is not. |
| Rate limit (429) | The reservation budget defers the channel for up to 60 seconds, then defers it to the next run rather than failing it. | A quota crunch should delay data, not lose it. |
| Ingest cron exceeds 300 seconds | Vercel kills the function mid-batch. Channels already written stay written, because there is no transaction to roll back and every write was an upsert. | The next run selects stalest-first, so the channels that were cut off are the first ones processed. Self-healing without a queue. |
| Model provider unreachable or 401 | complete() retries transient failures three times with backoff, fails fast on permanent ones with a message naming the fix. No brief row is written. | A half-written brief is worse than no brief. |
| Model output fails verification | One repair turn with the exact failing strings. If it still fails, the brief is stored with ok false and the UI renders the verification panel listing every ungrounded claim. | Nothing ships silently. The failure is on the face of the document, which is the entire point of the design. |
| Repair turn itself throws | Caught. The first draft is kept with its original verdict. | A failed repair must not lose a usable draft. |
| Fact sheet has thin or partial data | buildCaveats injects caveats into the sheet, the prompt requires every one to appear in the output, and verify.ts fails the brief if any is missing. | The caveat is the part a model most wants to drop and an editor most needs. |
| Database unavailable | Route-group error boundaries render an error state instead of a stack trace. /api/health reports it to an uptime probe. | |
| Post deleted upstream | The row and its history remain with the last known metrics. Snapshots simply stop. | Deleting our copy would silently rewrite last week's numbers. |
| Share token leaked | Anyone with the URL reads that dashboard. Mitigation is rotating the token. | Stated plainly because it is a real risk of the feature, not a bug. |

The pattern across all of these: prefer stale data to wrong data, prefer partial
completion to rollback, and put failures where a person will see them.

---

## 7. Scaling math

Assumptions, stated so they can be argued with: a tracked company averages five
channels and twenty posts a day across all of them. Ingest runs eight times a
day. The refresh overlap is two days, so a post is re-read on roughly sixteen
runs before it stops changing. The default analysis window is ninety days.

Storage estimates use roughly 1.5 KB per post row after TOAST compression of the
raw payload, and roughly 100 bytes per metric snapshot before its index. Measure
these against a real month before budgeting on them.

| | 10 companies | 100 companies | 1,000 companies |
|---|---|---|---|
| Channels | 50 | 500 | 5,000 |
| Posts per day | 200 | 2,000 | 20,000 |
| Posts per year | 73,000 | 730,000 | 7.3 million |
| Metric snapshots per year | 1.2 million | 12 million | 117 million |
| Database growth per year | under 0.5 GB | 3 to 5 GB | 35 to 45 GB |
| Ingest wall clock per run | about 60 seconds | about 10 minutes | about 105 minutes |
| YouTube quota used per day | about 400 of 10,000 units | about 4,000 of 10,000 | about 40,000, over quota |
| Infrastructure per month | 25 to 40 dollars | 90 to 150 dollars | 400 to 900 dollars |
| Metered X per month, 12 accounts per landscape | about 180 dollars | about 1,800 dollars | about 18,000 dollars |

### Where it actually breaks, in order

**First break, around 200 to 250 channels: the ingest cron wall clock.** At
concurrency four and roughly five seconds per channel run, the runner clears
about 240 channels inside the 300 second Vercel ceiling. That is roughly 40 to 50
companies, which is earlier than it looks and is the first thing to hit in real
use. Three fixes in increasing order of effort: raise concurrency (bounded by
platform rate limits, and the reservation budget already handles the contention),
shard the cron by platform or by a hash bucket over channel ids, or move
ingestion onto a queue and let the cron only enqueue. The queue is the right
answer past a few hundred channels and is not needed before that.

**Second break, around 250 YouTube channels: the free Data API quota.** Forty
units per channel per day against a 10,000 unit daily allowance. Fixes are a
quota increase request, which Google grants for legitimate use, or dropping the
YouTube refresh cadence, which costs freshness and nothing else.

**Third break, and only in a shape nobody actually builds: query time.** This is
the important nuance. Query cost scales with **landscape size**, not with total
companies tracked. A ninety-day leaderboard over a fifteen-company landscape
aggregates about 27,000 posts and runs in tens of milliseconds off
posts_company_posted_idx, whether the database holds 50 companies or 5,000. The
1,000-company case in the table above is a hundred landscapes of fifteen, not one
landscape of a thousand. So the read path stays flat and only storage and
ingestion grow. If someone does build a 200-company landscape, the fix is a
materialised daily rollup per company, per platform, per day, which the schema
already supports adding without touching a single read call site, because every
read goes through queries.ts.

**The thing that actually gets expensive is not infrastructure.** At 100 tracked
companies the database and hosting are under 150 dollars a month and the metered
X bill is 1,800. The paid data API is the cost model of this product, and the
refresh overlap window is the dial that controls it. That is why it is called out
in three separate documents and why making it a per-platform setting is the top
item on the Next list.

### What this does not do

No cache tier. Server Components re-query on each render, which is fine at this
data size and would need Next.js data cache or a materialised view at the second
break above. No read replica. No background job queue. No search index. Every one
of those is a real answer to a real scaling problem and none of them is a problem
yet, and building them now would be building infrastructure for a load that does
not exist against a product that has not proven anyone wants it.
