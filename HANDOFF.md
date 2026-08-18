# Handoff

Read this first, then `CONTRACTS.md` and `docs/ARCHITECTURE.md`.

## What this is

Data Dumpster is a competitive social-intelligence platform for newsrooms and
Boston Globe Media's internal replacement for Rival IQ. It is live, uses real
vendor spend, and must be treated as a production data product.

    Live      https://www.datadumpster.boston
    Repo      https://github.com/GlobeKarolian/data-dumpster
    Local     ~/Developer/pressbox

The Vercel project, deployment URL and local directory still use the original
name `pressbox`. The product is Data Dumpster. Only user-facing strings use the
product name; do not rename deployment infrastructure casually.

## Local facts that save time

- The shell may export `NODE_ENV=production`. Use `unset NODE_ENV` or
  `npm ci --include=dev` before commands that need development dependencies.
- Typecheck with `./node_modules/.bin/tsc --noEmit`; `npx tsc` does not resolve
  correctly in this repository.
- Secrets stay in the ignored `.env.local` and in Vercel. Never commit them and
  never overwrite an existing `.env.local` during a deploy.
- Next.js 16 in this checkout has breaking changes. Read the relevant guide in
  `node_modules/next/dist/docs/` before changing framework APIs.

## Production and takeover state, 3 August 2026

- The application is live and recurring collection is active. `vercel.json`
  opens pooled collection windows exactly twice daily, at 00:00 and 12:00 UTC.
  Offset ten-minute recovery ticks drain only continuations, paid receipts and
  retries already in the durable queue; they cannot make fresh profiles due.
  A separate ten-minute wake preserves progress for existing coordinator jobs.
  Alerts, weekly briefs and report delivery still have authenticated routes but
  no recurring schedules.
- Recent closed-day audience gaps exist and cannot be reconstructed. This is an
  honest data limitation, not a reason to fill cells with zero. Read the current
  state from `/api/health`; do not copy a point-in-time channel or post count into
  documentation.
- EnsembleData's X endpoint returns a Twitter-selected Highlights feed, not a
  chronological timeline. It is useful for public profile and engagement facts
  but can never certify a requested post window. The collection-outcome
  migration clears legacy false coverage and records this as a terminal source
  limitation without repeatedly buying the same feed.
- Facebook vendor reads can end at a cursorless post cap. Those runs are useful
  but incomplete and must not be retried as if a network error occurred.
- The checkout contains the takeover foundation: explicit adapter completeness,
  durable queue outcomes, fail-closed Ask and Brief verification, canonical
  follower-rate arithmetic, active cron documentation, CI, and a reviewed
  migration sequence. Apply every committed migration immediately before
  deploying the matching code.
- Boston Globe Media's Tech Provider Access Verification was verified on
  3 August 2026. That verification is independent of App Review and does not
  evidence Page Public Content Access production approval. The available
  records do not establish PPCA's production status; confirm it in Meta's
  dashboard. The Meta app remains unpublished, and the pooled runner still
  excludes PPCA credentials. Use
  `docs/META-PPCA-APPLICATION.md` for the application and production gates.
- Two product decisions remain: GBH News has collected posts but belongs to no
  landscape, and the requested Post Library rebuild is separate from Content
  Analysis.

## Non-negotiable correctness rules

1. **Audience is a stock, not a flow.** Every audience read uses the latest
   snapshot inside the window through the helpers in `src/lib/metrics/`. Never
   sum daily follower snapshots.
2. **`changePct` returns `null` on a zero baseline.** Never print Infinity or a
   spectacular percentage manufactured by a tiny denominator.
3. **Missing is not zero.** Availability travels with every aggregate. A post
   without a valid `followersAtPost` is excluded from follower-rate arithmetic;
   if no post is measurable, the result is `null`.
4. **AI may narrate only an exact, code-computed fact sheet.** Ask pins the
   displayed filter state with a fingerprint. Ask and Brief each get at most one
   repair pass and reject the output if deterministic verification still fails.
   Unverified prose is neither saved nor rendered.

## Release gate: isolate owned data

Public company, channel and post observations are pooled across organizations.
That is correct only for public, comparable fields. The current schema also has
global ownership flags, cursors, collection state and post payloads, while
credentials are organization-scoped.

Phase 0 containment is implemented in this checkout. Pooled collection and
profile resolution now use an explicit allowlist of deployment-wide public
sources, force the adapter's public path, reject owned-mode onboarding, and
exclude Meta owner/PPCA, TikTok owner, LinkedIn admin, X owner and Bluesky app
credentials.
That stops new owner-derived values from entering pooled rows through the normal
runner. Legacy rows may already contain private fields or payloads and still
need inventory, quarantine and public re-collection.

The pooled acquisition control plane is also implemented. One normalized
platform account maps to one global channel row, while each landscape records
its own required window in `landscape_channel_demands`. Those demands reconcile
to one global job and one lease, so adding an already tracked brand reuses its
history and fresh coverage instead of buying a second crawl. After a fetch, the
runner must claim the normalized platform id before writing audience, posts or
payloads. A blank, changed or already-claimed id is a permanent operator-review
failure: no observations land and histories are never merged automatically.

Company and channel deletion is disabled in the product API because it would
destroy pooled history. Stop tracking by removing landscape membership. The
only global pause is an explicit admin quarantine, limited to a company that is
not shared with another organization.

Per-user landscape access is implemented. Owners and admins see every
landscape; editors and viewers require `user_landscape_access` grants managed
from Settings > Users. The migration preserves every restricted user's current
access. New landscapes may create their focus company inline, reuse a pooled
match and automatically grant a restricted creator access to the result.

Do not present the product as safely multi-tenant and do not expand owned-native
collection until the split in `docs/OWNED-DATA-ISOLATION.md` is implemented and
its cross-tenant acceptance suite passes. The required boundary is:

- pooled, source-scoped public collection for competitive analytics;
- globally unique channel identity plus organization-private
  `landscape_channel_demands` carrying each landscape's requested window;
- verified organization-channel credential bindings;
- separate organization-private observations, payloads, cursors and jobs; and
- an explicit `public_comparable` or `owned_native` basis on every metric.

## Architecture in one paragraph

Next.js 16 App Router and React 19 run on Vercel, with strict TypeScript,
Tailwind v4, Drizzle ORM and Neon Postgres. Server Components call the metric
layer directly; client interactions and external consumers use thin validated
route handlers. Platform adapters return normalized posts, audience readings
and an explicit completeness contract. A Postgres-backed queue leases work with
`SKIP LOCKED`, runs up to ten network-bound channel workers, and records a
durable scheduling outcome separately from the presentation status. Model
providers sit behind `ModelProvider`, and deterministic verification is the
only path from generated prose to a user.

Measurement SQL lives in four modules, not one:

- `src/lib/metrics/queries.ts`: primary summaries, leaderboards, posts, URLs,
  fact sheets and report inputs;
- `src/lib/metrics/content-analysis.ts`: Content Analysis;
- `src/lib/metrics/ingestion-coverage.ts`: exact-window collection coverage;
- `src/lib/metrics/daily-coverage.ts`: audience-day monitoring and recovery.

## Current source policy

The implemented source order and approval matrix is in `README.md`.
`docs/DATA-ACCESS.md` records the official-platform access background; verify its
vendor inventory against code before treating it as current. The operative
policy is:

- Bluesky and YouTube use sanctioned public interfaces.
- Existing pooled Facebook profiles use Bright Data only. Meta owner and PPCA
  credentials are excluded until public grants and owned insights have explicit
  bindings and storage. New Facebook profile onboarding is temporarily disabled
  because identity currently requires purchasing the posts crawl twice.
- X uses the official X API v2 first whenever the deployment Bearer token is
  configured (app-only, pay-per-use, adopted 17 August 2026). It is the only X
  source that certifies a chronological window, and impression_count is public
  through app-only auth, so views are measured. Bright Data is the X fallback.
- Instagram, TikTok and Threads use Bright Data first whenever its deployment
  key is configured. A live Bright Data receipt is always resumed and a failed
  paid stage never falls through to another vendor. EnsembleData is used for
  those platforms only when Bright Data is absent; X still uses its synchronous
  profile lookup during onboarding. Coverage is certified only when a source
  provides real evidence of exhaustion.
- LinkedIn competitor company pages use Bright Data's company and company-post
  datasets. Likes, comments and follower stock are measured; shares, saves,
  views, reach and impressions are unavailable, and the cursorless history is
  always source-limited. Reddit publisher-user collection remains on
  EnsembleData until a like-for-like Bright Data account feed is verified and
  remains gated on confirmation that commercial use is covered.
- Truth Social public profiles and posts use Apify's maintained
  `tri_angle/truth-scraper` actor when `APIFY_API_TOKEN` is configured.
  Followers, favourites, replies, reblogs and media are collected; views and
  saves are unavailable. A paid actor request is not retried inside the adapter.
- Purchased or scraped collection is a Legal and procurement decision, not a
  developer default. RSS is retired and must not be reintroduced.

Before writing any mapper, call the real vendor endpoint and inspect the actual
response. Vendor documentation has already been wrong about Instagram reel
views, TikTok cover images and endpoint depth.

## What is built

Cross-Channel and per-platform views (including a Growth patterns section with
stock-correct audience carry-forward), leaderboards, Social Posts, tags and AI
tagging (LLM tagging is live: fingerprint-driven recompute, per-org spend
ceiling, docs/AI-TAGGING.md), Posted URLs, Story Cloud, Content Analysis,
alerts, custom dashboards,
verified weekly briefs, exact-scope Ask, user and source administration,
bring-your-own-model configuration, Weekly Reports, PowerPoint and sectioned CSV
exports, email and tenant-bound Slack delivery, run-now, schedules and a delivery
audit. Report delivery is implemented; only its dispatcher schedule is inactive.

Election Center is also implemented as an authenticated multi-race workspace.
Each race owns a private backing landscape while reusing pooled companies,
channels, posts and collection history. The production seed starts with the
Massachusetts U.S. Senate Democratic primary on 1 September 2026, with Ed
Markey and Seth Moulton and the campaign-account roster supplied by the user.
Supplied URLs resolve, deduplicate and enter the durable collection queue
automatically. Facebook campaign URLs skip a duplicate paid verification crawl;
their first real Bright Data collection must claim the stable platform id before
any observation can land. Only a genuine pooled-identity conflict is sent to a
person for review.

## Priority order

1. Complete the remaining phases of `docs/OWNED-DATA-ISOLATION.md`. This is a
   release gate, not a later hardening task.
2. Validate the full foundation, run the pooled-identity audit, apply
   every committed migration in `drizzle/` (currently `0000_collection_outcome.sql`
   through `0026_wikipedia_attention.sql`) via `npm run db:migrate`, deploy
   the matching application, then inspect health and collection outcomes in
   production. Never reverse that migration-before-code order. The migration
   journal's `when` values must stay strictly increasing — 18 Aug 2026 found
   three entries out of order being silently skipped by drizzle-kit while it
   reported success; the ledger and journal are repaired and the next
   workstream should take 0027.
3. Resolved 17 August 2026: the official X API v2 is the chronological X
   source, adopted on pay-per-use billing. Watch the first weeks of spend via
   the ingestion audits and X's /2/usage/tweets endpoint.
4. Obtain and record Legal/procurement decisions for every purchased source,
   including Reddit commercial use and TikTok/Threads competitor collection.
5. Tune alerts with real newsroom use, activate only approved brief/report
   schedules, and finish the Post Library and remaining export/UX parity work.
6. Resolve GBH News landscape membership as a product decision.


## Session additions, 17-18 August 2026

Landed on main and deployed, beyond the numbered priorities above:

- X collection restored end to end via the official API (the fifth source
  control point, `selectedPublicSourceKey`, was still planning Bright Data).
  Spend is metered in `/api/health` alongside AI usage and Bright Data
  delivered-record volume (labelled estimate).
- Nightly off-Neon backups: every table as gzipped NDJSON to the private Blob
  store, resumable, manifest-is-completion, staleness degrades health
  (`src/lib/backup.ts`).
- Weekly report search sections read screenshots with the org's vision model
  (`/api/reports/search-screenshot`); rows save on arrival. Tesseract remains
  only as history; its public/ocr assets are dead weight pending removal.
- Adobe importer refuses cross-suite panels for any suite including STAT; the
  contaminated 8/10-8/16 statReferral section was repaired from STAT's own
  export (backup of the bad section in outputs/).
- RivalIQ history imported: 7,465 follower readings into audience_snapshots
  (visibility='rivaliq-import') and 7,760 brand-week flows into
  external_brand_metrics, surfaced in Growth patterns.
- Audience series carry stocks forward across mixed cadences (90-day bound);
  bucket keys come from lib/dates bucketKey — the server-clock Monday drift
  broke every week-granularity chart on UTC and passed locally in Eastern.
- Facebook net-change rounding artifacts are flagged (≈) via
  metrics/source-rounding; Boston 25's +106,894 was a vendor rounding-bucket
  flip, not growth.
- Election Center: per-candidate Wikipedia lookup attention (official
  Wikimedia API, user traffic only), one year backfilled, daily refresh in the
  recovery cron. Instagram/Threads posters now archive to Blob before their
  signed URLs expire.
- Landscapes: Globe New Hampshire Market and Globe Rhode Island Market created
  with 69 verified channels (see git log for the rebrand notes: Coastal ABC,
  Ocean State Media). MLB demands widened to Opening Day 2026-03-26.
- OpenRouter is a first-class model provider (enum value, key shape, picker),
  and its completions meter the provider-reported charged cost (usage
  accounting via `usage:{include:true}`), preferred over the per-Mtok
  estimate. Before this, every OpenRouter row wrote cost_usd=0 and the
  AI_TAGGING_DAILY_USD ceiling never bound. Rows metered before the fix
  (about 1,100 on 18 Aug) still read zero; their token counts are real, and
  OpenRouter's dashboard remains ground truth for the gap.
- AI tagging is observable: `/post-tags` carries a pipeline strip, and
  `/post-tags/live` animates settles as they happen (4s poll). The live page
  server-renders real numbers into the first paint — a session whose client
  JS never runs still sees the truth — via `lib/tagging/activity.ts`, shared
  with `/api/tags/activity`.
- Every tag in the product links to the Social Posts explorer filtered to
  that tag with the viewer's scope carried (`TagLink`, plus name links on the
  performance table and manage list; `tags` was already an explorer filter).

Open decision awaiting the operator: window-scoped completeness for WoW
deltas — the current gate conflates unfinished May backfill with an incomplete
report week, but for 8/10-8/16 specifically it is also correctly masking the
X outage hole in the prior week. Do not relax the gate without amending the
contract note on `MetricRow.complete`.

## Working method

- Be direct. If a claim is uncertain, check it against code, a live response or
  an authoritative source before writing it down.
- Preserve unrelated work in a dirty tree. Do not reset or overwrite it.
- Verify adapter mappers against a sanitized real response.
- Run `./node_modules/.bin/tsc --noEmit`, lint, tests, build and
  `drizzle-kit check` before a production handoff.
- Never apply a schema change after deploying code that already reads its new
  columns.

## Read next

    CONTRACTS.md                       correctness and build contract
    docs/ARCHITECTURE.md               system design and failure behavior
    docs/OWNED-DATA-ISOLATION.md       required public/private split
    docs/DATA-POOLING.md               why public observations are shared
    docs/DATA-ACCESS.md                official access and legal background
    docs/ENSEMBLEDATA.md               observed vendor contracts
    docs/RIVALIQ-TEARDOWN.md           incumbent and parity gaps
    docs/PRD.md                        product requirements and priorities
    docs/DEPLOY.md                     migration and production runbook
