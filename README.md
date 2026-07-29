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
says so on its own face.

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
auditable a year later.

**Ask** is natural-language questions over the same fact sheet. It refuses when
the fact sheet does not contain the answer, and tells you which filter or date
range would produce it. The refusal is the feature.

**Alerts** evaluate hourly: competitor outliers, audience swings, volume drops,
new channels, keyword hits, share-of-voice shifts. Findings deduplicate on a
stable key, so an hourly job does not mean an hourly Slack message.

**Dashboards** are saved widget layouts, optionally published at an unguessable
share URL for people who should see one chart and not the whole tool.

**Settings** covers model connections (with a live health check and an actual
dollar-spend panel read off the usage table), per-org platform credentials
encrypted at rest, and company and landscape management.

---

## What works today, and what needs a key

| Source | Competitor data | Needs | Status |
|---|---|---|---|
| Bluesky | Full: posts, likes, replies, reposts, quotes, followers | Nothing. No key, no account | Works out of the box |
| YouTube | Full public stats: views, likes, comments, subscribers | Free Data API key, 10k units/day | Works with a free key |
| RSS / Atom | Full, where a publisher runs a feed | Nothing | Works out of the box |
| X / Twitter | Posts, likes, replies, reposts, quotes. No impressions | Paid API access, metered | Works with a paid key |
| Instagram | Thin: followers, media, likes, comments, on Business accounts only | Meta app plus App Review, weeks | Works with review approval |
| Facebook | Public Page posts, reactions, comments, shares, via Page Public Content Access | Meta app plus App Review for PPCA, business verification, weeks | Implemented; owned channels only until PPCA is granted |
| TikTok | None available to a commercial organisation | Developer app, owned accounts only | Owned channels only |
| LinkedIn | None, at any price | Marketing API approval, owned pages only | Owned channels only |
| Threads, Reddit | Reddit is feasible, Threads is not | No adapter written yet | Not built |

The distinction between the open rows and the gated ones is the single most
important fact about this product category, and "docs/DATA-ACCESS.md" is the
long version with costs, approval burden and sources. Facebook sits in between:
the data exists and Meta will grant access to it, but only through
[Page Public Content Access](https://developers.facebook.com/docs/features-reference/page-public-content-access/),
which is App Review plus business verification and takes weeks.
"docs/META-PPCA-APPLICATION.md" is the guide to applying.

AI features need a model connection. Configure one in Settings, or set
DEFAULT_MODEL_PROVIDER and the matching key in the environment. Ollama needs no
key at all and no network egress.

---

## Stack

Next.js 16 (App Router, React 19 Server Components), TypeScript in strict mode,
Postgres via Drizzle ORM on the Neon serverless driver, Tailwind 4, Recharts,
Auth.js v5 with credentials, Zod for every request boundary, Vercel Cron for
scheduling. 183 TypeScript files, roughly 26,400 lines under "src".

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

**2. Environment.** Copy the example and fill in the three required values.

    cp .env.example .env.local

- DATABASE_URL: on Vercel, Storage, Create, Neon, then copy the pooled URL.
- ENCRYPTION_KEY: openssl rand -base64 48. Encrypts platform tokens and model
  API keys at rest with AES-256-GCM. Rotating it orphans every stored secret.
- AUTH_SECRET: openssl rand -base64 32.
- CRON_SECRET: openssl rand -hex 32. The cron routes fail closed without it.

Everything else in ".env.example" is optional and documented in place.

**3. Create the schema.**

    NODE_ENV=development npm run db:push

**4. Seed the workspace shape.**

    SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=... NODE_ENV=development npm run seed

The seed creates the Boston Globe Media org, eight real companies (Globe,
Boston.com, STAT, Herald, WBUR, GBH, Axios Boston, Globe Sports), their public
channels, two landscapes and eight newsroom tags. It creates zero metrics. Every
number in Data Dumpster comes from ingestion, because a seeded number that looks real
is a number somebody eventually puts in a deck. It is idempotent, so re-running
it is safe.

**5. Pull real data.** Bluesky and RSS need no credentials at all, so this works
immediately on a clean machine.

    NODE_ENV=development npm run ingest:once -- --platform=bluesky,rss

Add --dry-run to fetch and report without writing. Add --json for machine output.
The runner exits 1 only when every attempted channel failed, so a wrapper can
tell "nothing worked" from "one token expired".

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
                            same query functions, plus the three cron endpoints.
    src/app/share/          Public dashboard rendering, token-authorized.
    src/db/schema.ts        The whole data model. Read this first.
    src/lib/metrics/        definitions.ts is the metric dictionary the tooltips
                            render. contract.ts is the read interface.
                            queries.ts is the SQL.
    src/lib/adapters/       One file per platform, one shared interface, a
                            registry, and the ingestion runner.
    src/lib/ai/             Provider abstraction, prompts, the verifier, brief
                            generation, and per-call cost metering.
    src/components/         UI. charts/, shell/, ui/, and one folder per feature.
    scripts/                seed.ts and ingest.ts.
    docs/                   Everything below.

## Documentation

- **docs/PRD.md**: the product requirements. Users, jobs, metric model,
  what is built, what is next, what is explicitly out of scope.
- **docs/ARCHITECTURE.md**: data flow, schema reasoning, failure modes, and the
  scaling math at 10, 100 and 1,000 companies.
- **docs/DATA-ACCESS.md**: what each platform will actually give you, what it
  costs, and how long approval takes. Read before promising anyone a chart.
- **docs/BYO-MODEL.md**: why bring-your-own-model is the differentiator, with a
  worked cost comparison across providers.
- **docs/BUILD-VS-BUY.md**: the honest comparison against Rival IQ, including
  the conditions under which buying is the right call.
- **docs/CRONS.md**: why each schedule is what it is.
- **docs/DEPLOY.md**: production deployment on Vercel, step by step.
- **docs/META-PPCA-APPLICATION.md**: how to apply for Page Public Content
  Access, what the screencast has to show, and why applications get rejected.
- **docs/PITCH.md**: why this exists.
- **CONTRACTS.md**: the build contract the parallel agents worked from.

## Honest limits

TikTok and LinkedIn competitor data does not exist for a commercial organisation
in 2026. Data Dumpster labels those gaps instead of filling them.

Facebook competitor data does exist, but it is gated. Page Public Content Access
is a real Meta App Review feature, and Meta's own Pages documentation lists
"aggregated, anonymized public content for competitive analysis and
benchmarking" as an allowed usage. Until an org is approved for it, Data Dumpster
treats Facebook as owned-only and says why rather than charting a zero. Applying
is weeks of work, not an afternoon. See "docs/META-PPCA-APPLICATION.md".

Rival IQ has been collecting since roughly 2013. A decade of stored competitor
time series, including CrowdTangle-era Facebook data that exists nowhere else,
cannot be reconstructed. Data Dumpster starts its clock the day you run the ingest.

Engagement rate by view is undefined for essentially every competitor on every
platform, because no public API exposes impressions for content you do not own.
Views of 0 in this system means "not exposed", never "nobody saw it", and the
metrics layer stores NULL rather than 0 so the difference survives.
