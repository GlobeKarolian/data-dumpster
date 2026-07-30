# Handoff

Written for another AI assistant, or a human, picking this up cold. Read this
first, then `CONTRACTS.md`, then the docs listed at the bottom.

## What this is

Data Dumpster: a competitive social intelligence platform for newsrooms, built
as an internal replacement for Rival IQ at Boston Globe Media. Live in
production, real data, real vendors, real money.

    Live      https://pressbox-kappa.vercel.app
    Repo      https://github.com/GlobeKarolian/data-dumpster
    Login     matt@karolian.com  (owner)
    Local     ~/Developer/pressbox

Note the naming split: the Vercel project and local directory are still
`pressbox`, the original name. The product was renamed to Data Dumpster later
and only user-facing strings changed. Do not "fix" this without asking; the
deployment URL is shared with people.

## Environment facts that will waste your time if you miss them

- **The shell exports `NODE_ENV=production`.** Every npm command must be
  `unset NODE_ENV; npm run ...` or dev dependencies silently vanish.
- **`npx tsc` does not work.** Use `./node_modules/.bin/tsc --noEmit`.
- **Shell calls time out around 60 seconds.** Long builds, deploys and ingests
  must be backgrounded to a log file and polled.
- Secrets live in `.env.local` (gitignored) and in Vercel env vars for all three
  environments. Nothing sensitive is in git; history was scanned.
- Vercel CLI is authenticated as `matt-8982`, team `mkarolians-projects`.
  `vercel deploy --prod --yes` works directly.

## Current state, verified 29 July 2026

    Platform    Posts  Source
    bluesky     1,685  public AT Protocol, no key
    facebook      945  Bright Data (vendor)
    instagram     677  EnsembleData, feed + reels separately
    youtube       623  official YouTube Data API v3
    tiktok        488  EnsembleData
    threads        45  EnsembleData
    TOTAL       4,855  65.6M views, 7.6M engagements

Two landscapes, built from Matt's Rival IQ CSV exports: **BGM** (14 owned
brands) and **Boston News Market** (22 companies). Focus company is The Boston
Globe in both. RSS was deliberately removed; see the note in
`src/lib/adapters/registry.ts`.

## The three rules this codebase is built on

Violating these is worse than shipping nothing, because the entire pitch rests
on them.

1. **Never invent a number.** A percent change against a zero baseline returns
   `null`, not Infinity and not a four-figure percentage. Missing data is a
   visible blank with a caveat, never a zero.
2. **Every metric carries its definition** from
   `src/lib/metrics/definitions.ts` into a UI tooltip.
3. **AI narrates a pre-computed fact sheet and nothing else.** It cannot query.
   `src/lib/ai/verify.ts` re-checks every number in generated prose against the
   fact sheet. Do not loosen this.

## Architecture in one paragraph

Next.js 16 App Router, TypeScript strict, Tailwind v4, Drizzle ORM against Neon
Postgres. Pages are Server Components importing query functions from
`src/lib/metrics/queries.ts` directly with no HTTP hop; API routes in
`src/app/api/*` are thin wrappers over the same functions for client
interactivity. Ingestion is one `ChannelAdapter` per platform behind a uniform
contract in `src/lib/adapters/types.ts`, with vendor-specific modules beside
them (`tiktok-ensemble.ts`, `instagram-brightdata.ts`, and so on). AI providers
sit behind `ModelProvider` in `src/lib/ai/types.ts` so the org supplies its own
inference.

## Data vendors, and the lesson that cost the most time

Three sources, chosen on measured evidence rather than preference:

| Source | Used for | Cost | Measured |
|---|---|---|---|
| EnsembleData | TikTok, Instagram, Threads | $400/mo Silver, 11k units/day | 100% success, 2s median |
| Bright Data | Facebook only | ~$25/mo pay-as-you-go | 42 to 81% success, 44 to 127s |
| YouTube Data API | YouTube | free, 10k units/day | 100%, 25 channels in 15s |

Bright Data was first and is being retired everywhere except Facebook, which
EnsembleData does not cover. The measurements are in `docs/ENSEMBLEDATA.md`.

**The lesson, stated plainly because it caused three separate bugs:** an
endpoint inventory tells you what exists; only a response body tells you what a
field contains. Every one of these came from trusting documentation over a
`curl`:

- Instagram capped at 12 posts because the profile endpoint was used instead of
  the discovery endpoint. `limit_per_input` does not lift it.
- Every Instagram post stored zero views and nothing was typed as a reel,
  because only `/instagram/user/reels` returns `play_count` and
  `product_type: clips`. Feed and reels are two calls, deliberately.
- A claim that YouTube needed no API key, written from the endpoint list. The
  channel listing returns relative dates ("1 day ago") and no engagement, so
  the official API is strictly better.

**Before writing any adapter mapping, curl the endpoint and read the payload.**

## What is done

Cross-channel and per-platform screens, leaderboards, social posts explorer,
post tags with rules and AI tagging, posted URLs, Story Cloud (event-level
clustering with who-broke-it), Weekly Report builder modelled on Matt's actual
Platforms Dashboard and Digest, AI briefs with claim verification, Ask, alerts,
custom dashboards, user management with invite links, BYO model settings,
Content Analysis (topics, hashtags, formats, channels, post times), full-screen
raccoon refresh overlay, raccoon cursor.

## What is not done, in the order I would do it

1. **Scheduled exports.** Rival IQ mails PowerPoint and CSV on a schedule. This
   is the largest gap, because it is how the product reaches people who never
   log in. The Weekly Report has the content and only exports on demand.
2. **Twitter ingestion.** 22 channels have never run. EnsembleData covers it at
   `/twitter/user/info` and `/twitter/user/tweets`; the vendor path is written in
   `twitter-brightdata.ts` but the EnsembleData version is not.
3. **Crons are off.** `vercel.json` has an empty `crons` array because Matt
   chose manual runs while sources were changing. Turning them back on is a
   decision about vendor spend, not a technical task. Ask first.
4. **There are no tests.** Zero. The highest-value ones are `changePct` null
   behaviour, `safeDiv`, and the rule that audience is a stock (latest reading in
   a window) rather than a flow (never summed).
5. **Audience history is one day deep.** Every net-change and week-over-week
   figure reads blank until a few more days accumulate. Real data, honest blank,
   but it looks empty.
6. **GBH News has 380 posts and belongs to no landscape.** Not in either CSV.
   Needs Matt's call, not a guess.
7. **Post library rebuild.** Matt asked for it and it was not started. The
   Content Analysis screen is adjacent but not the same thing.
8. **`src/lib/adapters/util/http.ts` is half dead code**, duplicated in
   `request.ts`, and its own header comment is now false. A reviewer will spot
   it in ninety seconds. Fifteen minutes to fold together.

## Known cosmetic and small issues

- Company slugs are globally unique now (pooling), so `companies.orgId` is
  attribution only. Do not reintroduce it as a tenancy filter.
- Three Instagram channels time out on the reels call and degrade to feed only.
  A re-run picks them up.
- `docs/PITCH.md` section 6 is Matt's negotiating position for a CTO role. Move
  it out of the repo before sharing the repo with anyone at the Globe.
- `docs/PITCH.md` and `docs/DATA-VENDORS.md` contradict each other on whether to
  buy scraped data. Unresolved on purpose; it is Matt's risk call.

## Working style Matt asked for

- **Do not spawn subagents for small work.** They cost minutes of startup for
  work that takes seconds directly. He said stop, explicitly.
- Be direct. No preamble. Own mistakes plainly.
- No em dashes. No "it's not x, it's y" constructions.
- He pushes back when something sounds wrong, and he has been right every time:
  on Facebook PPCA existing, on Bright Data having a Threads scraper, on the
  Instagram post cap being an endpoint choice rather than a product limit.
  **When he pushes back, go and check rather than defending.**

## Docs worth reading, in order

    CONTRACTS.md               the build contract and metric vocabulary
    docs/ENSEMBLEDATA.md       vendor inventory, prices, the three findings
    docs/DATA-ACCESS.md        what each platform will and will not sell
    docs/RIVALIQ-TEARDOWN.md   the incumbent, catalogued, with a gap analysis
    docs/DATA-POOLING.md       why shared collection is how you beat them on cost
    docs/PRD.md                product requirements
    docs/ARCHITECTURE.md       system design
    docs/DEPLOY.md             runbook
    docs/feedback/*.md         simulated stakeholder objections, from Matt's notes
