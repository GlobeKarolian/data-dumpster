# Public data pooling and owned-insight isolation

**Status:** Phase 0 containment plus global channel identity and per-landscape
public demand are implemented in the takeover checkout. Legacy observation
cleanup and the owned-native stream remain required before this product can be
treated as safely multi-organization.

**Decision:** Shared public observations remain pooled. Every organization
choice, credential, ownership relationship, private metric, private payload,
cursor, and collection job must be organization-scoped.

This document refines `docs/DATA-POOLING.md`. Pooling is a cost and consistency
advantage only for data that is both publicly observable and contractually safe
to pool. A value obtained through an account owner's credential is not made
public merely by writing it into a shared row.

## Why this change is required

The current model combines global and tenant-private concerns:

- `channels.isOwned`, `channels.cursor`, `channels.active`, and
  `channels.lastIngestedAt` are global.
- Credentials are organization-scoped, but credential fields for an
  organization and platform are still merged for settings and health checks
  instead of resolving one explicit connection.
- `channel_collection_state` has one row per global channel and retains the
  legacy `requestedByOrgId` field, although source credentials no longer use it.
- Historical runs may have written owner-only values into global posts,
  snapshots, audience rows, raw payloads, and cursors.
- Competitive analytics reads those global values without a provenance or
  visibility boundary.

Phase 0 stops new normal-path leakage: pooled collection and profile resolution
use only allowlisted deployment public credentials, force the public adapter
path, reject owned-mode onboarding and exclude Meta owner/PPCA, TikTok owner,
LinkedIn admin, X owner and Bluesky app credentials. Global channel identity and exact
per-landscape demand also prevent duplicate accounts and last-writer-wins demand.

Legacy owner-derived Instagram saves and reach, authenticated X impressions,
LinkedIn administrator statistics, signed media URLs, and private raw payloads
may still affect shared history. Tenant-facing global pause and legacy ownership
state also remain unsafe control boundaries.

`requestedByOrgId` is now compatibility metadata used for deterministic private
tag fan-out fallback, not source selection. It must still be removed after the
replacement path is live.

## Required invariants

1. A public job never reads an owned-insights credential unless that credential
   has an explicit, reviewed public-pooling grant.
2. An owned job always has an organization, a verified channel binding, and one
   explicitly selected credential connection.
3. A private observation always has an `orgId`. A pooled observation never has
   one.
4. Private values and owner payloads never enter `posts`,
   `post_metric_snapshots`, or `audience_snapshots`.
5. Two organizations using the same public scope receive identical public
   metrics.
6. One organization's refresh, pause, credential rotation, or deletion cannot
   change another organization's cursor, completeness, or job eligibility.
7. Competitive metrics never incorporate owned-only saves, reach, impressions,
   clicks, or native rates.
8. Missing private measurements remain `null` with an availability reason.
   Measured zero remains zero.
9. Public dashboard shares and competitive AI fact sheets contain only public,
   comparable facts.
10. `companies.orgId` remains attribution only and is never ownership proof.

## Two independent collection streams

### Public comparable

- Runs once globally for a shared channel.
- Uses a deployment-owned public source or an explicitly granted pooled source.
- Writes only allowlisted public fields.
- Feeds competitive dashboards, leaderboards, reports, alerts, exports, and the
  default AI fact sheet.
- Aggregates collection demand across organizations without carrying a tenant
  credential into the worker.

### Owned native

- Runs once per organization and verified channel binding.
- Uses one credential explicitly bound to that organization and channel.
- Writes private observations and payloads only to organization-scoped tables.
- Feeds a separate owned-performance query path.
- Never silently changes a competitive metric.

Every metric response and persisted analytical artifact will declare its basis:

```ts
type MetricBasis = 'public_comparable' | 'owned_native';
```

A screen may compare a public benchmark with private performance, but each
panel must identify its basis. Mixed arithmetic is prohibited.

## Target data model

### Global channel identity

One public account is one channel regardless of which landscape requested it.
`channels.identity_key` is the normalized, platform-specific fallback identity
used before a stable external id is known:

```text
channels.identity_key NOT NULL
UNIQUE (platform, identity_key)
UNIQUE (platform, external_id) WHERE external_id IS NOT NULL
```

Handle changes update presentation without creating another pooled channel.
Resolving an external id that already belongs to another row is a merge or
operator-review event, never a second identity. Company attribution remains
separate from organization ownership.

### Landscape channel demands

`landscape_channel_demands` is the organization-private demand layer. It is
keyed at the finest product scope that owns the request, so two landscapes in
one organization can ask for different windows without one silently widening or
removing the other's requirement:

```text
landscape_id
company_id
channel_id
required_since
required_until
created_at
updated_at
PRIMARY KEY (landscape_id, channel_id)
INDEX (channel_id)
```

Two composite foreign keys prove that the company belongs to the landscape and
the channel belongs to that same company. The database also rejects an inverted
window where `required_since > required_until`.

Landscape organization scope comes from the parent `landscapes` row. Org-level
tracking is derived by grouping demands through that join; it is not a second
mutable subscription table.

Adding a company to a landscape reconciles one demand per company channel.
Removing the company removes only that landscape's demands. Another landscape's
request remains intact. `channels.active` becomes an operator-only global
quarantine switch, not a tenant pause control.

The global public queue pools the minimum start and maximum end across current
landscape demands. The shared state widens monotonically during concurrent
enqueue operations so one requester cannot erase another's window; exact
per-landscape bounds remain in the demand rows. A channel may be claimed only
while at least one live demand exists. Each landscape health view compares
public coverage with its own requested window; an organization rollup groups
those landscape results.

### Credential connections

Replace merged credential fields with one logical connection per row:

```text
credential_connections
  id
  org_id
  platform
  provider
  purpose
  label
  encrypted
  external_subject
  capabilities
  status
  expires_at
  last_checked_at
  last_check_error
  created_at
  updated_at
```

Purposes include `owned_insights`, `public_discovery`, and `public_vendor`.
Resolution loads one connection by ID. It never merges every row for an
organization and platform.

Deployment public-vendor secrets remain separate from owned credentials.
Environment-based owned credentials are allowed only when they are pinned to a
single organization and a verified channel binding.

### Verified ownership

`owned_channel_bindings` proves that one credential controls one shared channel:

```text
id
org_id
channel_id
credential_connection_id
status
verified_external_id
capabilities
verified_at
last_error
created_at
disabled_at
```

The organization, credential, and at least one landscape demand for the channel
must agree. Platforms must match. At most one active verified binding may exist
per organization and channel. The external account ID returned by the platform
must match the shared channel identity.

A checkbox, matching company attribution, credential presence, or the identity
of the last requester is not ownership proof.

### Source-specific public state

Keep `channel_collection_state` as global logical public coverage, then remove
`requestedByOrgId`. Its `requiredSince` and `requiredUntil` are cached aggregates
of pooled landscape demand and may remain wider than any one current demand; the
demand rows remain authoritative for tenant-scoped health. Queue claims require
an `EXISTS` match in `landscape_channel_demands`, so an orphaned state row cannot
spend vendor units. Source cursors move to:

```text
public_channel_source_state
  channel_id
  source_key
  cursor
  last_ingested_at
  last_success_at
  last_error
  PRIMARY KEY (channel_id, source_key)
```

EnsembleData, Bright Data, and native API cursors must never overwrite one
another. Public source selection is deterministic and policy-based.

### Owned collection state

Owned leases and cursors are entirely separate:

```text
owned_channel_collection_state
  org_id
  channel_id
  binding_id
  required_since
  required_until
  coverage_since
  coverage_until
  attempted_until
  cursor
  status
  outcome
  attempts
  next_attempt_at
  lease_token
  lease_until
  last_error
  updated_at
  PRIMARY KEY (org_id, channel_id)
```

### Private observations

Use typed nullable columns. Maintain a latest table for efficient reads and an
append-only snapshot table for history:

```text
org_post_insights_latest
org_post_insight_snapshots
org_audience_insight_snapshots
org_post_payloads
```

Common provenance fields include `orgId`, `postId`, `bindingId`, `sourceRunId`,
`capturedAt`, `availability`, and the measured private values. Owner-only raw
JSON, signed media references, and source metadata belong in
`org_post_payloads` under an explicit retention policy. Global `posts.raw`
becomes a small allowlisted public object and is eventually removed.

### Run provenance

Create the ingestion audit row before source access, then attach every write to
that run. Add:

```text
visibility: public | org_private
org_id nullable
source_key
credential_connection_id nullable
owned_binding_id nullable
billing_org_id nullable
```

Database checks enforce that public runs have no owned organization, binding,
or credential, while private runs have all three and they belong to the same
organization.

## Initial field classification

| Platform | Public comparable | Organization private |
|---|---|---|
| Facebook | Page identity, posts, reactions, comments, shares, public audience | Page insights, reach, impressions, saves |
| Instagram | Public identity, captions, permalinks, likes, comments, public audience, public vendor plays | Saves, reach, owner-sourced following, signed media, owner raw data |
| TikTok | Vendor-observed identity, posts, followers, likes, comments, shares, views | OAuth state and future owner-only fields |
| X | Identity, text, likes, replies, reposts, quotes, public audience | Authenticated impressions, restricted bookmarks, owner raw data |
| YouTube | Current Data API fields | Future YouTube Analytics fields |
| LinkedIn | Global identity; post content only after policy approval | Impressions, clicks, native rate, administrator statistics, raw data |
| Threads, Bluesky, Reddit | Current public observations | Future owner insights |

Unknown fields default to private until reviewed. Promotion requires an
allowlist change and tests.

## Migration plan

### 0. Contain

Implemented in the takeover checkout:

- all pooled runner and profile-resolution calls use the deployment public-source
  allowlist rather than organization credentials;
- adapters receive `__isOwned=false`, and owned-mode onboarding is rejected;
- Meta owner/PPCA, TikTok owner, LinkedIn admin, X owner and Bluesky app
  credentials are excluded; and
- legacy `isOwned` no longer selects a pooled source.

Still required:

- stop every tenant control from changing global pause and ownership fields;
- treat legacy `isOwned` as a contamination signal in operator tooling; and
- fall back to quarantined or re-collected public data when provenance is
  ambiguous.

Owned insights may temporarily be unavailable. Restoring a private-to-global
write path is not an acceptable rollback.

### 1. Add schema

Global identity keys and landscape demands are implemented in the takeover
checkout, including coherence foreign keys, window validation and claim-time
demand checks. Their migration backfills identity and exact landscape demand
idempotently and must refuse ambiguous identity collisions for operator review
rather than picking a winner.

Still add connections, bindings, private observations, source-specific public
state and audit provenance without removing legacy columns during the rollback
window. Migration `0003_public_run_provenance.sql` adds nullable source-run and
visibility links to new pooled audience, post, and metric rows plus an explicit
source key/visibility on ingestion runs. The runner creates the audit row before
network access, defaults to `unselected:<platform>`, and fails closed if the
response does not identify an allowlisted public source. Legacy null provenance
is intentionally not backfilled by guesswork.

### 2. Convert credentials

Create one `legacy_merged` connection per organization and platform to preserve
current configuration, mark it `needs_verification`, and retain old rows through
the rollback period. Future settings writes create one logical connection.

Do not activate owned bindings from legacy flags. Require platform identity
verification.

### 3. Quarantine legacy private values

Copy before deleting. A value for a channel tracked by exactly one organization
may enter that organization's quarantine with provenance `legacy_unverified`.
Values on channels shared by multiple organizations remain operator-only until
ownership is proven.

- Move Instagram saves and reach to private storage and recompute public
  engagement without saves.
- Quarantine authenticated X views unless run-level provenance proves a public
  source.
- Move LinkedIn administrator statistics and raw payloads to private storage.
- Allowlist Facebook public reaction fields, but scrub raw metadata.
- Promote TikTok owner-derived values only after policy review or public
  re-collection.

Apply the same rules to historical snapshots, not only current post rows.

### 4. Dual write and shadow compare

Deploy the split runner behind independent write and read flags. Private V2 data
must never dual-write back to global columns. Run public shadow comparisons and
audit every metric difference.

### 5. Re-collect public baselines

Re-fetch public sources for every channel whose global rows may contain
owner-derived values. Produce a reconciliation report covering post counts,
engagement differences, removed private fields, availability changes, and
coverage gaps.

### 6. Cut over reads

Switch competitive surfaces to `public_comparable`, then enable owned-native
surfaces only for verified bindings. Keep public shares public-comparable.

### 7. Remove legacy state

After two stable release cycles, remove `requestedByOrgId`, global `isOwned`,
mixed-source channel cursors, tenant-facing global pause controls, legacy
credential merging, and unsafe global payloads.

## Read-only legacy contamination inventory

Run this before any isolation migration, cleanup, or public-read cutover:

```sh
npm run db:audit-owned-contamination
```

This is a release gate, not a repair command. It executes two aggregate-only
`SELECT` statements in a database-enforced `READ ONLY`, repeatable-read
transaction. It never mutates rows or calls a vendor. It does not select or
print handles, post text, URLs, media values, raw payload contents, cursor
contents, run details, errors, credentials, or the database URL.

The JSON report groups findings by platform and current sharing scope:

- `untracked`;
- `single_landscape`;
- `multiple_landscapes_one_org`; or
- `shared_across_orgs`.

It counts legacy `isOwned` flags, non-empty mixed-source cursors and channel
metadata, runs without source/visibility provenance, non-empty run error/detail
presence, global observations on legacy-owned channels, raw post payload
presence, saves, restricted/unreviewed views, Instagram media-reference
presence, audience following/extras, and all post/audience snapshot rows lacking
a source-run boundary. It also compares the live global-table columns with the
columns this audit has classified. A new or missing global column blocks release
instead of disappearing from the report.

Exit status is part of the contract:

- `0`: the classified schema matches and no contamination/ambiguity signal was
  found;
- `1`: contamination, ambiguous provenance, or schema drift was found; and
- `2`: the read-only query or result validation could not complete, so the gate
  failed closed.

A populated legacy database is expected to exit `1`. The current schema cannot
attach an observation to a trustworthy source run or visibility decision, so
every existing ingestion run, post, post-metric snapshot and audience snapshot
is ambiguous until it is quarantined or re-collected through a proven public
path.

Exact limitations:

- The command reads aggregate presence/count signals, not sensitive values. It
  cannot determine which credential or organization produced a legacy row.
- Sharing is derived from current landscape membership. It cannot reconstruct
  which organizations shared a channel when a historical write occurred.
- Nonzero/non-null tests cannot find an owner-derived value stored as zero or
  null, overwritten later, or already folded into another metric.
- Public-looking values are not promoted based on appearance. Source and
  visibility provenance or public re-collection is required.
- It does not inspect encrypted credentials, infer ownership, prove vendor
  contract compliance, quarantine or repair data, or inspect future
  organization-private observation tables.
- A `0` result is necessary but not sufficient for the full release acceptance
  below; the cross-tenant tests and owned-native storage boundary still apply.

## Rollout and rollback

1. Back up the database and generate a read-only contamination inventory.
2. Pause new claims briefly and let active leases drain.
3. Apply additive schema and idempotent backfills.
4. Deploy containment and V2 writes with V2 reads disabled.
5. Resume public collection and monitor public and private queues separately.
6. Verify bindings, re-collect public data, and compare V1 with V2.
7. Enable public V2 reads, then owned reads per verified organization.
8. Perform destructive cleanup only after the rollback window.

A rollback leaves additive tables in place, disables public and private workers
independently, and returns competitive reads to a patched public-only path.
Private V2 rows remain available for replay. They are never copied back into
pooled storage.

## Release acceptance

The split is complete only when:

- no owner-only field exists in a global observation;
- no tenant credential is selected by request order;
- public analytics are invariant across organizations;
- owned insights require a verified organization-channel binding;
- every run and metric records source, visibility, and basis provenance;
- public shares and competitive AI fact sheets contain only public-comparable
  data; and
- `requestedByOrgId`, global `isOwned`, and the mixed-mode cursor are gone.

Cross-tenant tests must cover summary metrics, leaderboards, post exploration,
Content Analysis, Story Cloud, URLs, tags, alerts, dashboards and share tokens,
CSV and PowerPoint, reports, Ask, briefs, health endpoints, refresh behavior,
credential rotation, landscape-demand removal, identity collision handling, and
concurrent queue demand.
