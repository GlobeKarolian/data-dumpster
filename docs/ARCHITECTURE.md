# Data Dumpster architecture

**Audience:** the engineer maintaining the product and the executive deciding
whether its numbers are trustworthy.

**Shape:** Next.js 16 and React 19 on Vercel, Neon Postgres through Drizzle, nine
platform adapters behind one explicit fetch contract, a durable database queue,
a contained metric layer, and bring-your-own-model inference that cannot put a
number in front of a user without deterministic verification.

There is no RSS ingestion. There is no external message broker, cache tier,
search index or client state manager. The collection queue is persisted in
Postgres, not held in a serverless process.

---

## 1. End-to-end data flow

```text
landscape changes | scheduled dispatcher | one-shot CLI
        |
        v
landscape_channel_demands          exact private demand per landscape/channel
        |
        v
channel_collection_state           one pooled request, outcome, lease and coverage
        |
        v
src/lib/adapters/collection-queue.ts  SKIP LOCKED claims, ten network workers,
        |                           per-platform rate gates
        v
src/lib/adapters/runner.ts            public-source selection
        |
        v
src/lib/adapters/*                 fetch, normalize, declare completeness
        |
        v
platform APIs and purchased sources
  Bluesky | YouTube | Facebook | Instagram | TikTok | X | Threads | Reddit | LinkedIn
        |
        v
src/lib/adapters/runner.ts            stable-id gate, ordered writes and audit
        |
        v
Postgres                            pooled observations plus org-private product data
        |
        +--------------------+---------------------+
        v                    v                     v
metrics modules         reports/exports       AI fact sheets
        |                    |                     |
        v                    v                     v
Server Components       CSV/PPTX/delivery     deterministic verifier
and thin API routes                                |
                                                   v
                                              saved/rendered prose
```

The platform boundary is `src/lib/adapters/types.ts`. Adapters emit normalized
posts and audience readings plus explicit evidence about whether the attempted
window was exhausted. The rest of the application does not infer source
completeness from post count or HTTP success.

The measurement boundary is `src/lib/metrics/`. Server Components call it
directly, without making an HTTP request to their own deployment. Route handlers
exist for client-side filter changes, exports and external consumers; they
validate input, resolve the session and call the same modules.

---

## 2. Data model and trust boundaries

### Audience is a stock

`audience_snapshots` has one row per channel and calendar day. A rerun on the
same day replaces that reading. Audience for a window is the latest per-channel
snapshot inside the window, never the sum of its daily observations.

Audience net change requires at least two measured daily snapshots. Growth rate
also requires a non-zero starting stock. Missing history and a zero baseline
therefore produce `null`, not zero, Infinity or an attention-grabbing percentage.

### Engagement is a changing flow

`posts` stores the current normalized values for efficient analytical reads.
`post_metric_snapshots` stores repeated observations keyed by post and capture
time so engagement velocity remains reconstructable. `followersAtPost` travels
with each post; historical follower-rate arithmetic never joins against today's
audience.

The canonical engagement rate by follower is:

```text
mean over measurable posts of (post engagementTotal / post followersAtPost)
```

A post without a positive follower denominator is excluded from both the sum
and count. If no post is measurable, the result is `null`. Pooled engagement
divided by pooled followers is a different statistic and is prohibited.

Some sources represent an unavailable native counter as storage-level zero.
That raw value does not prove measured zero. Coverage and metric availability
must decide whether a product surface, export or fact sheet may render it.

### Measurement SQL is contained, not singular

The old architecture described `queries.ts` as the only SQL. The actual boundary
is four modules:

- `src/lib/metrics/queries.ts`: summaries, leaderboards, series, posts, URLs,
  tags, post types, fact sheets and report inputs;
- `src/lib/metrics/content-analysis.ts`: topic, hashtag, format, channel and
  posting-time analysis;
- `src/lib/metrics/ingestion-coverage.ts`: certified coverage for the exact
  organization, landscape, companies, platforms and date window on screen;
- `src/lib/metrics/daily-coverage.ts`: day-level audience monitoring and the
  recovery sweep.

`definitions.ts` owns the user-facing vocabulary and caveats;
`follower-rate.ts` owns the canonical per-post arithmetic. New analytical SQL
belongs inside this boundary with a testable contract, not in a page component.

### Public pooling and the owned-data release gate

Companies, channels and public observations are pooled because the same public
fact should not be purchased once per organization. Landscapes, tags,
dashboards, briefs, reports and alert configuration are organization-private.
`companies.orgId` records attribution for a pooled company and is not a tenancy
filter; landscape membership plus the session organization is the analytical
scope.

Landscape visibility adds a second private boundary inside an organization.
Owners and admins are universal. Editors and viewers require a matching
`user_landscape_access` row, and the same check is applied to the shell,
Server-Component context, analytics routes, media previews, reports, briefs,
alerts and dashboards. This is authorization, not navigation: removing an item
from the landscape switcher alone is never considered enforcement. A denied
identifier returns not found so it cannot be used to enumerate private sets.

Landscape creation accepts either an existing pooled focus company or a new
focus company in the same request. When the new company already exists in the
global pool, its row and history are reused; otherwise the company is created
and immediately made the first landscape member. This avoids both the empty
focus state and a client-side create-company/create-landscape race.

The current model is not yet a complete boundary for owned-native insights.
Global `channels.isOwned`, mixed-source cursors and raw payloads are legacy
structures, and historical pooled rows may contain owner-derived values.

Phase 0 containment prevents new leakage through the normal path. Pooled
collection and profile resolution use only an explicit allowlist of
deployment-wide public sources, force `__isOwned=false`, and reject owned-mode
onboarding. Meta owner/PPCA, TikTok owner, LinkedIn admin, X owner and Bluesky
app credentials cannot be selected for pooled writes. Global channel identity
and organization-private `landscape_channel_demands` are also implemented.
Legacy rows still require inventory, quarantine and public re-collection.

The fetched stable platform id is checked after the public source responds but
before any observation is written. The runner normalizes the id and claims it
under the platform's global unique index. A blank id, a changed id for an
already-bound row, or an id already claimed by another channel becomes a
permanent operator-review outcome with zero observation writes. The runner does
not merge histories or decide that two conflicting rows are the same account.

Company and channel deletion is disabled in product routes because either would
cascade shared history. Removing landscape membership is the scoped stop
operation; it removes that landscape's demand while leaving identity and
observations available for later reuse. `channels.active` is reserved for an
explicit admin-only global quarantine and cannot be changed by one organization
when the company is also shared with another.

`docs/OWNED-DATA-ISOLATION.md` remains a release gate. The implemented public
foundation is globally unique channel identity, organization-private
`landscape_channel_demands`, one demand-gated public collection job and an
allowlist of deployment sources that excludes owner and Bluesky app
credentials. Still required are source-specific public cursors, field-level
public allowlisting and run
provenance, legacy-data cleanup, and an organization-scoped `owned_native`
stream with verified channel/credential bindings, private observations, private
payloads, private cursors and private jobs.

Competitive screens, public share links, exports, alerts and competitive AI
fact sheets must use only `public_comparable` data. Mixed-basis arithmetic is
not allowed.

---

## 3. Durable collection

### Explicit fetch results

An adapter may return one of three completeness shapes:

```ts
{ hasMore: false, exhaustive: true }
{ hasMore: true,  exhaustive: false, incompleteReason: string }
{ hasMore: false, exhaustive: false, incompleteReason: string }
```

The first certifies the attempted window. The second promises a durable
continuation for the same window. The third records a terminal source
limitation: useful observations arrived, but the source cannot prove the whole
window. Missing flags never certify coverage.

The runner maps source and operational behavior to five scheduling outcomes:

| Outcome | Scheduling behavior |
|---|---|
| `certified_complete` | Merge the attempted window into certified coverage; no immediate retry |
| `continuation` | Preserve the original window and continue immediately |
| `terminal_source_limitation` | Advance attempted freshness, keep coverage uncertified, stop paid retry |
| `retryable_operational_failure` | Keep coverage and attempt watermark unchanged; exponential backoff |
| `permanent_failure` | Stop until an operator or forced request changes the state |

Presentation status (`succeeded`, `partial`, `failed`) is not a scheduler. This
separation prevents a capped Facebook snapshot or X Highlights response from
becoming an endless paid failure loop.

### Queue lifecycle

`landscape_channel_demands` stores one exact window per landscape and channel,
with composite foreign keys proving landscape membership and channel/company
coherence. Reconciliation pools the minimum start and maximum end per channel
into one durable `channel_collection_state`. The shared state widens safely
under concurrent enqueues; each live demand widens monotonically until its
membership is removed, and the demand table retains that landscape's exact
required window. On-screen coverage requires certified public coverage to span
the union of that demand and the exact selected window. A globally wider state
does not make an otherwise covered landscape incomplete. A state row is not
claimable without at least one live demand.

Adding an already-tracked channel to another landscape records the new demand
immediately. If certified pooled coverage spans the request, reconciliation does
not queue another purchase. A recent terminal source limitation also suppresses
an immediate repurchase of the same unavailable history, but remains visibly
uncertified. An older feasible uncovered window creates one widened global job.
Removing the last demand makes the retained state unclaimable but does not
delete its cursor, coverage or observations.

Reconciliation requests a 90-day window for an uncollected profile and
considers a settled profile fresh for twelve hours. Incremental work re-reads a
two-day overlap because post engagement changes after publication.

Workers claim eligible rows with `FOR UPDATE SKIP LOCKED`, a unique lease token
and a six-minute lease. The normal queue runs at up to ten workers because these
tasks are network-bound; each platform still has its own reservation gate.
Vercel's active ingest call considers at most 250 channels and caps one adapter
read at 500 posts.

### Automatic refresh and recovery

Scheduled ingest opens one freshness window at 00:00 UTC and another at 12:00
UTC. Those are the only routine invocations allowed to reconcile tracked
profiles and create newly due work. Offset recovery invocations call the same
route with `mode=recover`; that mode skips reconciliation and can only claim
continuations, paid snapshot receipts and retries already in the durable queue.

The shell is a status monitor; clicking it does not purchase or queue data. It
polls the tenant-protected job endpoint when an existing coordinator is active
and shows worker-active profiles, queued profiles, eligible retry times and
recent outcomes. `POST /api/ingest/run` remains available for controlled
recovery clients and validates the editor and tenant, but it uses the same
twelve-hour freshness fence rather than forcing settled profiles due. One
active coordinator per landscape coalesces overlapping scopes. The separate
`/api/cron/refresh` wake runs every ten minutes only to recover an existing
coordinator dispatch; it creates no estate demand. Terminal progress/activity
is frozen, so later pooled collection cannot reopen or rewrite an old job.

`attemptedUntil` is distinct from `coverageUntil`. A source-limited channel can
refresh recent facts from its attempt watermark without claiming older history
or repurchasing the same unavailable window. Certified intervals merge only
when the adapter explicitly proves them.

### One-shot CLI

`npm run ingest:once` is a queue dispatcher, not a direct adapter path. It
collapses all joined landscape rows to distinct global channels, registers each
selected channel's demand once per sharing organization, and invokes the same
bounded queue claim used by cron. The first registration can force one manual
refresh; later organization registrations cannot create a second crawl because
all work is protected by the same channel lease. A channel with no landscape is
reported as untracked and cannot be crawled through this path.

`--dry-run` stops after the read-only target query. It previews the default
90-day window (or the supplied `--since`/`--until`) and matched, eligible and
untracked pooled channels. It does not import the writable queue, register
demand, call a vendor or write to the database.

### Ordered writes without a transaction

The Neon HTTP driver issues each statement independently and does not provide a
multi-statement transaction. The safe failure direction is re-read and repair,
so write order is load-bearing:

1. normalize and claim the fetched stable platform id;
2. upsert the audience reading;
3. load the follower timeline and upsert posts;
4. upsert metric snapshots;
5. replace posted URLs and add organization-private tag assignments;
6. persist the channel cursor and certified watermark last; and
7. write the ingestion audit on a best-effort basis.

There is one narrow cursor-only exception to step 1. A still-running Bright Data
stage may return no audience or posts but provide an explicit non-empty
continuation receipt. The paid Facebook, Instagram, TikTok, X and Threads stages
bind that receipt to the source, dataset, stage and exact attempted window. The
runner may save it before identity is known so the next worker polls the same
snapshot instead of triggering another paid job. A multi-stage adapter may also
carry a profile identity already returned by the preceding stage. No observation
is written before the stable-id gate, and a mismatched receipt fails closed.

Posts, audience, snapshots and tag assignments use idempotent keys. Posted URLs
have no suitable uniqueness constraint, so the runner deletes and reinserts the
affected post's URLs. They can be absent for a brief interval. If any dependent
write fails, the cursor is not advanced and the next run repeats the window.

The pooled post upsert is also the raw-payload containment boundary. Arbitrary
vendor responses are never persisted. Every platform has an explicit
default-deny policy; only Instagram retains a compact list of validated Meta
CDN poster and video candidates needed by the authenticated preview proxy. The
reader still understands legacy Instagram shapes so old previews keep working
while refreshed rows are scrubbed into the compact form.

One channel's failure never aborts the batch. Every statement is chunked below
Postgres's bind-parameter limit.

### Source truth that affects scheduling

- `publicSourceCredentials()` is an allowlist, not a merge of workspace keys.
  Pooled Facebook and LinkedIn use Bright Data. Instagram, TikTok, X and Threads
  use Bright Data whenever it is configured and EnsembleData only when it is
  absent; X retains EnsembleData only for synchronous profile onboarding.
  YouTube uses the deployment API key, Bluesky uses the unauthenticated public
  appview, and Reddit uses the deployment EnsembleData token.
- EnsembleData's X post endpoint returns Twitter-selected Highlights rather
  than a chronological timeline. It always records
  `terminal_source_limitation`; profile and engagement observations remain
  useful, but post coverage is not certified.
- A Bright Data snapshot with a live receipt is a continuation and resumes the
  same paid job. After 24 hours, one automatic replacement is allowed and
  counted in the cursor. A second stale snapshot gets one final receipt-only
  poll, then fails closed for operator review; it never starts another automatic
  paid job. A failure to persist any newly returned paid receipt is likewise a
  permanent operator-review outcome because an automatic retry could duplicate
  the purchase. A completed cursorless cap is a terminal source limitation.
- Official paginated sources may certify only after reaching their true window
  boundary. Hitting a local page or post cap without a safely persisted cursor
  remains incomplete.

The first committed migration, `drizzle/0000_collection_outcome.sql`, adds the
outcome and attempt fields and corrects legacy false certifications. It preserves
only legacy settled Bluesky and YouTube coverage, marks other unproved settled
rows limited, explicitly corrects EnsembleData X Highlights, and settles only
Facebook cap rows whose latest audit proves that exact condition.

`drizzle/0001_pooled_channel_demands.sql` adds the global identity constraints
and exact landscape-demand table. Its preflight refuses ambiguous normalized
identity or external-id collisions and directs the operator to the read-only
identity audit instead of silently choosing which historical row survives.

`drizzle/0002_pooled_identity_invariant.sql` idempotently reasserts the database
check that keeps every stored `identity_key` equal to its canonical
platform/handle normalization. `0003_mean_zaran.sql` adds observation
provenance. `0004_lucky_dagger.sql` through `0006_silent_kang.sql` add the
durable refresh coordinator, recovery/final-state fields and exact coalesced
request scopes. All committed migrations must succeed before application code
from this checkout is deployed.

---

## 4. AI and report integrity

### Ask

The Ask page computes one fact sheet from the selected landscape, date window,
platforms, companies, tags, post types and search text. It sends that exact scope
plus a SHA-256 fingerprint. The API recomputes the sheet and returns 409 before
model spend if the fingerprint changed.

The model receives no database or browsing tools. The verifier checks every
numeric claim against the prompt-visible fact index, requires the exact
array-indexed path, binds the cited subject to the metric, and applies shared
percentage guardrails. One repair turn is allowed. A second failure returns 422
and no answer is rendered.

### Briefs

Briefs use the same closed fact-sheet rule and additionally require every data
caveat to survive into the document. The first draft gets one repair attempt.
Only an explicit passing verification can be saved. A repair provider failure or
a second bad draft raises a verification error; unverified prose is not a
fallback. Historical rows without `verification.ok === true` are withheld.

The saved row contains the exact fact sheet, verification verdict, provider,
model, cost, latency and repair metadata beside the prose.

### Weekly Reports

The report screen, sectioned CSV, PowerPoint and deliveries render from one
stored `ReportDocument`; delivery never recomputes numbers under existing
narrative. Report schedules store weekday, hour and IANA time zone. A delivery
row freezes the report window, landscape, formats, recipients and destinations.

The Globe.com and Boston.com Web Search tables use the official Search Console
Search Analytics API with the report's inclusive start and end dates, Web Search
type, query dimension and top 20 rows sorted by clicks. The two Looker Studio
reports remain linked from the builder as a human audit trail; a report or short
share URL does not grant API access and production does not replay a Google
browser session. An interactive pull saves both tables and
invalidates only the search narrative. A scheduled delivery performs the same
pull when Search Console credentials are configured. Manual paste remains a
fallback when the connector is intentionally absent.

Email and Slack have separate durable states. Each destination is marked
`sending` before the network call. An ambiguous network outcome becomes
`unknown` and blocks automatic retry because the provider may already have
accepted it. Explicit rejection remains retryable and a successful destination
is never resent merely because another failed. The global Slack webhook fails
closed unless `REPORT_SLACK_ORG_ID` matches the schedule organization.

### Alerts

Alert evaluation and event deduplication are implemented. The route records a
fresh event before making best-effort Slack calls and isolates failure per rule.
It does not yet provide the destination-level delivery audit used by reports.
Its schedule is inactive, so documentation must not describe alerts as currently
hourly in production.

---

## 5. Time, schedules and health

All product metric windows and SQL buckets are explicitly pinned to
`America/New_York`. Report schedules use their stored IANA zone. The date helpers
and SQL specify the zone directly, including daylight-saving transitions; the
deployment process's ambient `TZ` is irrelevant and must not become a required
environment variable.

`vercel.json` is the source of truth for active UTC schedules. Recurring public
collection and same-day audience recovery are active; alert, brief and report
delivery schedules remain separate operating decisions:

| Route | UTC schedule | State |
|---|---|---|
| `/api/cron/refresh` | every ten minutes | active; wakes one existing coordinator only |
| `/api/cron/ingest?mode=scheduled&limit=250&postLimit=500` | 00:00 and 12:00 | active; only route mode that opens fresh work |
| `/api/cron/ingest?mode=recover&limit=250&postLimit=500` | minutes 5, 15, 25, 35, 45 and 55 | active; existing queue only |
| `/api/cron/alerts` | none | implemented, inactive |
| `/api/cron/brief` | none | implemented, inactive |
| `/api/cron/reports` | none | implemented, inactive |

The audience coverage route remains implemented but unscheduled. The two daily
collection windows capture stock readings while recovery mode prevents slow
vendor work from being dropped. Orphan active channels remain outside the
health denominator. A later run cannot reconstruct a missed stock reading.

`GET /api/health` is intentionally public and returns only booleans and
aggregates:

- HTTP 503 with `status: "down"` when the database cannot answer;
- HTTP 200 with `status: "degraded"` when required configuration is missing,
  any active demanded channel is overdue past 24 hours, or a closed audience day
  in the trailing window is incomplete;
- HTTP 200 with `status: "ok"` only when those checks pass.

Today is excluded from the closed-day degradation test because the recovery
sweeps still have time to act. A day is operationally complete at 98 percent of
active demanded audience-bearing channels; Reddit user accounts are excluded
because that source has no follower stock. `lastSuccessfulIngestAt` is the
latest settled source-attempt boundary, including a useful partial response.
`overdueChannels` uses only certified `coverageUntil`, so a freshly attempted but
terminally limited source remains visible instead of being painted green.

---

## 6. Failure behavior

| Failure | Durable behavior |
|---|---|
| Source 5xx, timeout or rate exhaustion | Retryable operational failure; channel backs off and other channels finish |
| Invalid or revoked credential | Permanent failure when the adapter can identify it; no quota-burning retry |
| Source returns a selected feed or cursorless cap | Useful rows land, attempted freshness advances, coverage remains uncertified, no automatic paid loop |
| Source returns a blank, changed or already-claimed stable platform id | Permanent operator-review outcome; no observations are written and histories are not merged |
| Serverless worker dies mid-batch | Completed statements remain; the lease expires; cursor-last ordering causes the unfinished window to be reread |
| Database unavailable | App error boundary handles authenticated screens; health returns 503/down |
| Model provider fails | No brief or Ask answer is shown; provider errors remain errors rather than prose |
| Model output fails verification | One repair; a second failure returns 422 and persists nothing |
| Report send is explicitly rejected | Failed destination may be retried without resending successful destinations |
| Report send has ambiguous outcome | Destination becomes `unknown`; automatic retry stops for operator review |
| Audience day closes with a gap | Health remains degraded; the missing stock is never backfilled or converted to zero |
| Post disappears upstream | Last known row and history remain; deletion does not rewrite prior reporting |

The governing preference is stale or explicitly incomplete data over a wrong
number, and partial repairable completion over a fake atomic guarantee.

---

## 7. Scaling boundaries

Read cost scales primarily with landscape size and selected window because core
queries constrain company ids and posted dates before aggregating. Collection
cost scales with active channels, platform latency, refresh overlap and vendor
pricing.

The first operational ceiling is the 300-second serverless collection window,
especially for slow purchased snapshots. The current response is a durable
queue, ten network workers, rate gates, bounded claims and resumable vendor
receipts. Past that ceiling, shard claims by platform or stable channel bucket,
then move workers off the request lifecycle; do not increase overlap blindly.

YouTube quota and paid-source units are source-specific ceilings and must be
measured from ingestion audits. Database reads should move to materialized daily
rollups only after query telemetry shows the need. A cache, replica, external
queue or search service is justified by observed load, not by a speculative
company count.
