# Public data pooling

**Scope:** internal Boston Globe Media infrastructure. Pooling is an acquisition
and consistency strategy for public observations, not permission to mix owned
credentials or organization-private analytics.

**Release gate:** `docs/OWNED-DATA-ISOLATION.md` defines the required boundary.
The product must not be treated as safely multi-organization until that split
and its cross-tenant acceptance suite pass.

## Why pool public observations

A public account has one observable post and audience history regardless of
which BGM landscape is looking at it. Collecting that account once gives every
authorized internal landscape the same public facts, avoids duplicate vendor
spend, prevents two copies from drifting, and lets a newly created landscape use
history already collected for another one.

This is the relevant cost principle behind incumbent products such as Rival IQ:
acquisition cost follows the number of distinct public channels, not the number
of views or landscapes that reference them. Data Dumpster applies that principle
inside BGM. It does not make an external shared-data business part of the product
scope.

## The required boundary

```text
POOLED PUBLIC IDENTITY AND OBSERVATIONS
  companies
  channels
  public posts and allowlisted raw provenance
  public post metric snapshots
  public audience snapshots
  public posted URLs
  source-specific public cursors and collection coverage

ORGANIZATION-PRIVATE PRODUCT STATE
  landscapes and landscape channel demands
  tags and tag assignments
  dashboards and public-share configuration
  briefs, reports and delivery records
  alert rules and events
  model connections, prompts, usage and spend
  credential connections and ownership bindings

ORGANIZATION-PRIVATE OWNED OBSERVATIONS
  reach, impressions, clicks, saves and native rates obtained as owner
  signed media and owner raw payloads
  owned audience and post insight history
  owned cursors, leases, jobs and run provenance
```

A field obtained through an owner credential does not become public because it
describes a public account or was written to a shared table. Unknown fields
default to private until reviewed and allowlisted.

## Global channel identity

The same account must resolve to the same pooled channel even when several
landscapes add it or its display handle later changes.

`channels.identity_key` is a normalized platform-specific fallback. The database
enforces one row per `(platform, identity_key)` and also one row per
`(platform, external_id)` when a stable external id is known. Resolving an
external id that already belongs to another row is an explicit merge or operator
review, never a silent duplicate.

That stable id is also a runtime pre-write gate. After a public fetch and before
any audience, post, snapshot, URL, tag or raw-payload write, the runner
normalizes the fetched id and claims it on the canonical channel row. A blank id,
a different id for an already-bound row, or an id already claimed by another row
records a permanent operator-review failure with zero observation writes. A
database error while checking the claim is retryable; histories are never
auto-merged in either case.

One narrow exception preserves spend without weakening the observation gate: an
empty, still-running Bright Data stage may persist its explicit continuation
receipt before identity is known, then verify identity when the same paid job
returns data. Facebook, Instagram, TikTok, X and Threads bind receipts to the
source, dataset, stage and exact window. LinkedIn uses the same receipt binding
for its separate company and company-post stages. A mismatch fails closed instead of
starting another paid job. After a multi-stage adapter has a source-resolved
profile id, it may carry that profile and its already-fetched audience stock
with the later receipt; the runner claims the id before writing the audience.
It never carries partially fetched posts. A snapshot that remains pending for
24 hours may be replaced automatically once. The replacement count travels in
the cursor; if the replacement also stalls, only its saved receipt is polled and
the channel then fails closed for operator review rather than purchasing work
again every day. If a newly returned paid receipt cannot be saved, the runner
also stops automatic retries: without that durable id it cannot distinguish a
safe poll from a duplicate purchase.

Company and channel identity are global facts. `companies.orgId` remains
attribution for who introduced a pooled company; it is not proof of ownership and
must not scope analytical reads.

## Landscape demand, one public job

`landscape_channel_demands` is the tenant-private control plane. One row per
landscape and channel records the company and exact public window that landscape
requires. Composite foreign keys prove both landscape membership and channel
company coherence. Adding or removing a company reconciles only that
landscape's demand, so one landscape cannot pause or narrow another one's
collection.

Enqueueing pools current demand into the global `channel_collection_state`:

```text
required_since = minimum landscape demand start
required_until = maximum landscape demand end
```

Only a channel with at least one live demand may be claimed. Multiple demands
therefore create one source request and one shared public result. Shared state
widens monotonically during concurrent enqueue operations; the exact
per-landscape bounds remain in the demand table and are used by scoped health.
They may be narrower than the cached global window. Org-level tracking is a
grouped view over landscape demands, not a second mutable subscription record.
Adding the same company to a second landscape reuses retained history and fresh
coverage. If the second landscape needs older uncovered history, it widens one
pooled job instead of creating a second crawl. Removing membership cascades only
that landscape's demand; removing the last demand makes retained state
unclaimable but does not erase its identity, cursor, coverage or observations.

`channels.active` is reserved for global operator quarantine. It is not a
per-landscape pause: the API requires an administrator, an explicit
`scope: "global"` acknowledgement, and refuses the change when another
organization shares the company. Product routes do not physically delete public
companies or channels because that would cascade pooled history. The normal
"stop tracking" operation is landscape membership removal.

## Every collection entry point shares the lease

Scheduled collection, run-now requests and `npm run ingest:once` all register
landscape demand and claim `channel_collection_state`; none may call an adapter
as a direct crawl bypass. The one-shot CLI collapses joined landscape rows to
distinct global channels, registers the selected channel once per sharing
organization, and scopes its queue claim to those channel ids. A concurrent
worker may win the lease, in which case the local command makes no vendor call
and leaves the durable demand queued.

The CLI's `--dry-run` is a read-only target preview. It shows the requested
window and matched, eligible and untracked pooled channels, but does not import
the writable queue, register demand, call a vendor or write anything. A channel
that belongs to no landscape is visible in the preview but cannot be crawled.

## Public collection and private use

Public source selection is deterministic. The current worker and profile
resolver use only an explicit allowlist of deployment public sources and force
the adapter's public path; they never choose an owned credential based on which
organization asked most recently. Source-specific cursor separation is stored
in `public_channel_source_state`, so EnsembleData, Bright Data and native API
cursors cannot overwrite one another. The legacy channel cursor remains only a
rolling-deploy/rollback mirror during the cutover.

Landscapes, queries and artifacts remain organization-guarded. Two organizations
asking the same public scope must receive identical public metrics, but their
tags, dashboards, reports, alerts and model activity remain separate.

Owned collection is a different stream. It requires an organization, a verified
channel/credential binding, organization-private state and private observation
tables. A UI may place `owned_native` performance beside a
`public_comparable` benchmark, but it must label the basis of each panel and may
not combine them into one arithmetic series.

New pooled leakage is contained, but legacy shared observations and payloads may
still include owner-derived fields. They require inventory, quarantine and
public re-collection before multi-organization use.

Retention, compaction, media, backup, and capacity policy is defined in
`docs/STORAGE.md`.

## Invariants

1. One public platform account maps to one global channel identity.
2. One or more landscape demands aggregate to one global public collection job.
3. A channel with no demand cannot consume vendor units.
4. One landscape's removal or refresh cannot alter another's demand.
5. Public observations are identical across organizations for the same scope.
6. Owned credentials, payloads, metrics, cursors and jobs remain
   organization-private.
7. Competitive screens, public shares, exports, alerts and AI fact sheets use
   only `public_comparable` data.
8. Every value retains source, run, visibility and metric-basis provenance.
9. Product operations remove landscape demand or apply a deliberate global
   quarantine; they do not destroy pooled company, channel or observation rows.

## What pooling does not solve

Pooling lowers duplicate acquisition, but it does not improve a source's legal
status, chronology or completeness. X Highlights remain a selected feed;
Facebook snapshots may remain capped; a purchased TikTok row still requires a
recorded Legal decision. The collection outcome and coverage layer must keep
those limitations visible no matter how many landscapes share the result.
