# Data Dumpster

Competitive social intelligence for newsrooms. It answers one question on every
screen: how does our brand compare to this set of competitors, on this metric,
over this window, against the previous window of equal length.

It is a working clone of Rival IQ, built as an internal platform for Boston
Globe Media, and it differs in three ways that were the whole reason to build it.

**Bring your own model.** Every AI feature runs on inference the organisation
controls. Point it at an Anthropic key, an Azure deployment, or an Ollama box in
the building. No newsroom content goes to a model the newsroom did not pick, and
model spend is a line item you can read in your own database.

**Numbers you can defend in a meeting.** Every metric carries its definition and
its caveat in a tooltip. Every AI-written sentence containing a number carries
the fact-sheet path that number came from, and a deterministic checker verifies
each one before a human ever sees the document. A brief that fails verification
is neither saved nor shown.

**Newsroom-native.** Posted-URL analysis, desk and vertical tagging, and
per-brand landscapes for the Globe, Boston.com and STAT are first-class, not
bolted on.

---

## The tour

**Cross-Channel** is the front door. Four headline tiles (audience, posts, total
engagement, engagement rate by follower), each with the prior-period delta and a
sparkline. Below that, the focus company's platform mix against the landscape
average, and the best post on each platform.

**Per-platform screens** for Facebook, Instagram, X, YouTube, TikTok and Bluesky.
Same shape, one network. Platforms that cannot serve competitor data are marked
as such rather than charted as zero.

**Leaderboards** rank every company in the landscape on any metric in the
dictionary, current versus previous, with the change.

**Social Posts** is a filterable, sortable, exportable table of every post
Data Dumpster has collected: company, platform, post type, date range, free-text
search, tag. Each row carries an outlier score, which is the post's engagement
divided by that company's median for the platform in-window. A 4.0 means it did
four times what that account normally does.

**Post Tags** are the newsroom layer. A tag is either a keyword or regex rule
evaluated at ingest, or a natural-language description handed to a model that
must quote the words in the post justifying the label. The tag performance table
shows lift: how a desk's content performs against that company's own baseline.

**Posted URLs** answers what a competitor is actually driving traffic to,
grouped by domain or by URL, with post counts and engagement per link.

**Briefs** generates the weekly competitive brief. Fact sheet computed in SQL,
model narrates, verifier checks, one repair pass if it failed, then the markdown
and the fact sheet and the verdict are stored together so the document is
auditable a year later. If the repair still fails, generation returns an error
and no prose reaches the reader.

**Ask** is natural-language questions over the exact fact sheet and filters on
screen. A fingerprint prevents the server from answering against data different
from the evidence the reader saw. It verifies every numeric claim and citation,
gets one repair attempt, and otherwise shows no answer.

**Alerts** implement competitor outliers, audience swings, volume drops, new
channels, keyword hits and share-of-voice shifts. Findings deduplicate on a
stable key and Slack notification is best effort. The evaluator route exists,
but its schedule is currently inactive.

**Weekly Reports** produces the screen, sectioned CSV and PowerPoint from one
stored report document. Email and tenant-bound Slack schedules, run-now and a
delivery audit are implemented. The delivery dispatcher schedule is currently
inactive.

**Dashboards** are saved widget layouts, optionally published at an unguessable
share URL for people who should see one chart and not the whole tool.

**Settings** covers model connections (with a live health check and an actual
dollar-spend panel read off the usage table), encrypted platform credentials,
and company and landscape management. Owned-native credential isolation is a
release gate described in `docs/OWNED-DATA-ISOLATION.md`; the current global
channel state is not a safe multi-organization ownership boundary. Phase 0 containment
prevents those owner credentials from being selected for new pooled collection.
Companies and public channels are pooled records, so the product does not offer
a destructive delete. Removing a company from a landscape removes only that
landscape's demand. An explicit admin-only global quarantine is available only
when the company is not shared with another organization.

---

## Source and approval matrix

| Platform | Current pooled source order | Comparable public coverage | Approval and limitation |
|---|---|---|---|
| Bluesky | Public AT Protocol appview | Posts, public engagement and followers | No credential. No views or saves |
| YouTube | Official Data API v3 | Videos, views, likes, comments and subscribers | Free API key; quota applies. No public shares or impressions |
| Facebook | Bright Data for existing pooled profiles | Public Page posts, reactions, comments, shares and audience | New profile onboarding is temporarily disabled because identity resolution would buy the crawl twice. Vendor snapshots can hit a cursorless cap. Meta owner and PPCA tokens are excluded from pooled work |
| Instagram | Bright Data; EnsembleData only when Bright Data is absent | Vendor-observed public account and media fields | An active or failed paid receipt never falls through to another vendor. Meta owner and Business Discovery credentials are excluded from pooled work |
| TikTok | Bright Data; EnsembleData only when Bright Data is absent | Vendor-observed public videos, views and engagement | Owner Display tokens are excluded from pooled work. The Research API does not permit this commercial use; competitor collection is a documented Legal decision |
| X / Twitter | Bright Data collection; EnsembleData onboarding and no-Bright fallback | Public profile and engagement fields | Owner Bearer tokens are excluded from pooled work. EnsembleData Highlights remain source-limited when used without Bright Data |
| Threads | Bright Data; EnsembleData only when Bright Data is absent | Vendor-observed public posts, engagement and audience | Official API is owned-only; competitor collection is purchased and requires approval |
| Reddit | EnsembleData user feed; retained legacy subreddit rows remain readable | Public submissions, score, comments and crossposts | New sources are user accounts. No trustworthy account follower stock. Confirm commercial-use rights before production collection |
| LinkedIn | Bright Data company + company-post datasets | Public follower stock, posts, likes and comments | No public shares, saves, views, reach or impressions. The source has no terminal history marker, so windows remain source-limited. Official owned analytics remain unavailable until organization-private storage and verified bindings exist |

RSS is retired and has no registered adapter. Purchased-source coverage is not
enabled merely because code exists: source terms, procurement and provenance
must be approved. The table above is the implemented runtime matrix;
`docs/DATA-ACCESS.md` provides official-platform access background, and
its Facebook section covers PPCA.

AI features need a model connection. Configure one in Settings, or set
DEFAULT_MODEL_PROVIDER and the matching key in the environment. Ollama needs no
key at all and no network egress.

---

## Stack

Next.js 16 (App Router, React 19 Server Components), TypeScript in strict mode,
Postgres via Drizzle ORM on the Neon serverless driver, Tailwind 4, Recharts,
Auth.js v5 with credentials, Zod for every request boundary, Vercel Cron for
scheduling, and a Postgres-backed collection queue.

No state manager, no data-fetching library, no component kit. Server Components
call the query layer directly; the API routes exist for client interactivity and
external consumers, not as an internal hop.

---

## Quickstart

Requires Node 20 or newer and a Postgres database. Neon is what this is built
and tested against; any Postgres 15+ works.

**1. Install.** Note that this machine exports NODE_ENV=production, which makes
npm silently skip dev dependencies.

    NODE_ENV=development npm install

**2. Environment.** Copy the example without overwriting an existing local file,
then fill in the four required values.

    cp -n .env.example .env.local

- DATABASE_URL: on Vercel, Storage, Create, Neon, then copy the pooled URL.
- ENCRYPTION_KEY: openssl rand -base64 48. Encrypts platform tokens and model
  API keys at rest with AES-256-GCM. Rotating it orphans every stored secret.
- AUTH_SECRET: openssl rand -base64 32.
- CRON_SECRET: openssl rand -hex 32. The cron routes fail closed without it.

Everything else in ".env.example" is optional and documented in place.

**3. Create the schema.** On a new, empty local database, push the current schema
once, then run the idempotent migration baseline so later migrations have an
accurate ledger. `--force` is destructive and is not an upgrade command.

    NODE_ENV=development npm run db:push -- --force
    NODE_ENV=development npm run db:migrate

Existing deployments must not use `db:push`; use the audited migration flow in
`docs/DEPLOY.md`.

**4. Seed the workspace shape.**

    SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=... NODE_ENV=development npm run seed

The seed creates the Boston Globe Media workspace shape from the declared
companies, channels, landscapes and newsroom tags in `scripts/seed.ts`. It
creates zero metrics. Every number in Data Dumpster comes from ingestion,
because a seeded number that looks real is a number somebody eventually puts in
a deck. It is idempotent, so re-running it is safe.

**5. Pull real data.** Bluesky needs no credentials, so this works
immediately on a clean machine.

    NODE_ENV=development npm run ingest:once -- --platform=bluesky

The one-shot command registers the selected channels' demand across their
landscapes, then claims the same global channel state and durable lease as the
scheduled worker. It never calls an adapter directly, so a concurrent worker
cannot make it buy the same crawl twice. Channels that belong to no landscape
are reported but never crawled.

Add `--dry-run` for a read-only preview of the proposed window and the matched,
eligible and untracked pooled channels. Dry-run registers no demand, imports no
writable queue path, makes zero vendor calls and writes nothing. Add `--json`
for machine output. Exit 1 means an explicitly requested channel was not found
or every result actually attempted failed; invalid input, missing database
configuration, or a selection consisting only of untracked channels exits 2.

**6. Run it.**

    NODE_ENV=development npm run dev

Sign in at http://localhost:3000/login with the seeded admin credentials.

**Before you commit anything:**

    ./node_modules/.bin/tsc --noEmit

---

## Repo layout

    src/app/(app)/          Authenticated screens. Server Components that call
                            the query layer directly, no HTTP hop.
    src/app/api/            Route handlers. Thin Zod-validated wrappers over the
                            same query functions, plus AI, administration and
                            scheduled-job endpoints.
    src/app/share/          Public dashboard rendering, token-authorized.
    src/db/schema.ts        The whole data model. Read this first.
    src/lib/metrics/        definitions.ts is the metric dictionary. Primary SQL
                            is in queries.ts; Content Analysis and coverage use
                            content-analysis.ts, ingestion-coverage.ts and
                            daily-coverage.ts.
    src/lib/adapters/       One file per platform, one shared interface, a
                            registry, the ingestion runner, and the global
                            demand-gated collection queue.
    src/lib/ai/             Provider abstraction, prompts, the verifier, brief
                            generation, and per-call cost metering.
    src/components/         UI. charts/, shell/, ui/, and one folder per feature.
    scripts/                seed.ts and ingest.ts.
    docs/                   Everything below.

## Documentation

- **docs/PRD.md**: the product requirements. Users, jobs, metric model,
  what is built, what is next, what is explicitly out of scope.
- **docs/ARCHITECTURE.md**: data flow, schema reasoning, failure modes, and the
  operational boundaries.
- **docs/OWNED-DATA-ISOLATION.md**: the release-gating split between pooled
  public observations and organization-private owned insights.
- **docs/DATA-POOLING.md**: canonical public account identity, per-landscape
  demand and one leased crawl per distinct channel.
- **docs/DATA-ACCESS.md**: official-platform access, policy and approval
  background. Check the runtime matrix above for implemented vendor ordering.
- **docs/BYO-MODEL.md**: why bring-your-own-model is the differentiator, with a
  worked cost comparison across providers.
- **docs/BUILD-VS-BUY.md**: the honest comparison against Rival IQ, including
  the conditions under which buying is the right call.
- **docs/CRONS.md**: why each schedule is what it is.
- **docs/DEPLOY.md**: production deployment on Vercel, step by step.
- **docs/PITCH.md**: why this exists.
- **CONTRACTS.md**: the build contract the parallel agents worked from.

## Honest limits

Purchased competitor data exists for platforms whose official APIs do not sell
it to a commercial newsroom. That makes legal approval, source provenance and
coverage evidence part of the product. A vendor response is useful data, not
proof that a requested window was complete.

Facebook competitor data is officially available through Page Public Content
Access, but approval takes weeks and paid fallback snapshots can be capped.
EnsembleData's X feed is selected Highlights rather than a timeline. Both cases
render an explicit source limitation instead of a green completeness claim.

Rival IQ has historical data that cannot be reconstructed. Data Dumpster starts
its measured history when collection begins. Audience net change remains blank
until at least two daily snapshots exist, and a missed closed day is permanent.

Engagement rate by follower is the mean of each post's engagement divided by
the follower reading attached to that post. Posts without a positive follower
denominator are excluded, and the result is blank when none is measurable. Some
adapters use storage-level zero for fields the platform did not expose, so raw
post counters must never be interpreted without product-level availability.

Public pooling and owned-native collection are not yet fully isolated. Treat
`docs/OWNED-DATA-ISOLATION.md` as a release gate before multi-organization use or
expanded owned-insight collection. Phase 0 prevents new owner credentials from
feeding pooled collection, but legacy shared rows still need audit, quarantine
and public re-collection.
