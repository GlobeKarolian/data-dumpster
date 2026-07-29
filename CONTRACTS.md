# Data Dumpster — build contract for parallel agents

Read this before writing a line. It is the only coordination mechanism between us.

## What we are building

Data Dumpster is a competitive social intelligence platform for newsrooms — a clone of
Rival IQ, built to be better in three specific ways, targeted at Boston Globe Media
as an internal tool.

Rival IQ's model, which we match:
- A **landscape** is a named competitive set: one focus company plus N competitors.
- Each **company** has **channels** (its handle on a platform).
- Every screen answers one question: *how does the focus company compare to this set,
  on this metric, over this window, versus the previous window of equal length?*
- Screens: Cross-Channel overview, per-platform overview, Leaderboards, Social Posts
  explorer, Post Tags, Posted URLs, Custom Dashboards, Reports, Alerts.

Where we beat it:
1. **Bring your own model.** All AI runs on inference the org controls. No vendor
   lock, no markup, no newsroom content going somewhere the newsroom did not pick.
2. **Honest numbers.** Every metric is defined in the UI, every AI claim is generated
   from a pre-computed fact sheet and is auditable. Rival IQ will print
   "engagement up 265,895.2%" without blinking; we will not.
3. **Newsroom-native.** Desk/vertical rollups and posted-URL analysis are first class,
   not bolted on.

## Absolute rules

- **TypeScript strict. `npm run typecheck` must pass when you finish.** This is not
  optional and it is how your work gets accepted.
- **Do not edit files you do not own.** File ownership is assigned in your prompt.
  If you need something from another agent's area, code against the interface in
  `src/lib/*/types.ts` and assume it exists.
- **Never invent a metric definition.** They live in `src/lib/metrics/definitions.ts`.
- **No mock data in production paths.** Seed data belongs only in `scripts/seed.ts`.
- **Shell note: this machine has `NODE_ENV=production` exported.** Always run npm as
  `NODE_ENV=development npm ...` or pass `--include=dev`, or dev deps vanish.
- Run commands from `/Users/mkarolian/Developer/pressbox`.
- Use `./node_modules/.bin/tsc --noEmit` (npx tsc does not work here).
- Write files with shell heredocs (`cat > path <<'EOF' ... EOF`) via
  Desktop Commander `start_process`. The `write_file` tool caps at 50 lines and will
  make you miserable. Load Desktop Commander tools with ToolSearch first if needed.

## Already built — do not recreate

| File | What it is |
|---|---|
| `src/db/schema.ts` | Full Drizzle schema. Read it first; it is the source of truth for the data model. |
| `src/db/index.ts` | `db` client (Neon HTTP driver). |
| `src/lib/types.ts` | `Platform`, `PostType`, `MetricKey`, `MetricRow`, `AnalyticsQuery`, platform labels + colors. |
| `src/lib/adapters/types.ts` | `ChannelAdapter`, `NormalizedPost`, `FetchContext`, `FetchResult`, `AdapterError`. |
| `src/lib/ai/types.ts` | `ModelProvider`, `CompletionRequest`, `ResolvedModelConnection`, `ModelError`. |
| `src/lib/crypto.ts` | `encrypt` / `decrypt` / `maskSecret` for tokens and API keys. |
| `src/lib/utils.ts` | `cn`, `compactNumber`, `formatChange`, `percent`, `slugify`, `safeDomain`. |
| `src/lib/dates.ts` | `presetRange`, `previousRange`, `autoGranularity`, `bucketKey`, `parseRangeParams`. |
| `.env.example` | Every env var, documented. Add yours here if you introduce one. |

## The metric vocabulary (canonical)

These names are used in the DB, the API, and the UI. Do not rename them.

- **applause** — likes / reactions / favorites / hearts / upvotes
- **conversation** — comments / replies
- **amplification** — shares / retweets / reposts / quotes
- **saves** — saves / bookmarks (where exposed)
- **views** — video or impression views (where exposed)
- **engagementTotal** — applause + conversation + amplification + saves
- **engagementPerPost** — engagementTotal / posts
- **engagementRateByFollower** — engagementTotal / followers / posts  ← the headline
  comparability metric; it is the only one that is fair across audience sizes
- **engagementRateByView** — engagementTotal / views (video only)
- **audienceNetChange** — followers(end) − followers(start)
- **shareOfVoice** — a company's posts ÷ all posts in the landscape
- **shareOfEngagement** — a company's engagementTotal ÷ landscape total

## Design language

Dense, quiet, and fast. Think Linear or Vercel's dashboard, not a marketing site.
- Neutral zinc/slate surfaces; one accent (`#C8102E`, Globe red) used sparingly.
- Data is the only thing allowed to be colorful; platform colors come from
  `PLATFORM_COLORS`.
- Numbers right-aligned and tabular (`tabular-nums`). Deltas green/red, muted.
- Every metric label has an info tooltip carrying its definition.
- Dark mode supported via Tailwind `dark:` classes throughout.
- No emoji anywhere in the product UI.
