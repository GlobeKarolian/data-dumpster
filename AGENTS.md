<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Data Dumpster

Read `HANDOFF.md` first, then `CONTRACTS.md` and `docs/ARCHITECTURE.md`, before writing any code.

Note the naming split: the Vercel project and this local directory are still called `pressbox`. The product is called Data Dumpster. Only user-facing strings were renamed.

## What it is

A Rival IQ competitor built for news organizations, for Boston Globe Media.

Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Drizzle ORM on Neon Postgres, deployed to Vercel at `pressbox-kappa.vercel.app`. Private mirror at `github.com/GlobeKarolian/data-dumpster`.

It ingests account- and post-level social data across Instagram, TikTok, Facebook, YouTube, LinkedIn and Threads through a `ChannelAdapter` interface — one adapter per platform in `src/lib/adapters/`, vendor client modules beside them in `src/lib/vendors/`. EnsembleData is the primary vendor; Bright Data is the fallback. AI features run behind a `ModelProvider` interface so the org brings its own model (Anthropic, OpenAI, Google, Azure, OpenAI-compatible, Ollama).

Two landscapes: **BGM** (14 owned brands) and **Boston News Market** (22 companies). There is no RSS ingestion and there should not be.

Public social data is pooled: `companies`, `channels` and `posts` are shared across orgs because the numbers are identical regardless of who is looking. `landscapes`, `postTags`, `dashboards` and `briefs` stay org-private. See `docs/DATA-POOLING.md`.

## Three rules that are not negotiable

1. **Audience is a stock, not a flow.** Followers is the *latest snapshot* inside a window. Never sum snapshots across days. Every audience read goes through the helpers in `src/lib/metrics/`, never a raw `SUM()`.
2. **`changePct` returns `null` on a zero baseline.** Never `Infinity`, never a four-figure percentage. A blank cell is correct; a fake number is not.
3. **Every number an AI feature states must come from a fact sheet computed in code**, then be verified against that sheet before it renders. No model-generated arithmetic reaches the user. See `src/lib/ai/` and `docs/BYO-MODEL.md`.

## Working method

- **curl the vendor endpoint and read the real response before writing a mapper.** Documented field names on these vendors are wrong often enough that assuming costs more time than checking. This has burned us on Instagram reels (`play_count` only exists on `/instagram/user/reels`, not `/posts`) and TikTok cover images (`{url_list: [...]}`, not a string).
- Typecheck with `./node_modules/.bin/tsc --noEmit`. `npx tsc` does not resolve in this repo.
- If npm drops dev dependencies, `unset NODE_ENV` first. A `production` value in the shell skips them silently.
- `drizzle-kit push` needs `--force` in a non-TTY.
- Never commit secrets. `.env.local` is gitignored and stays that way.

## Style

Be direct. No preamble, no flattery, no restating the question. Say plainly when you are unsure or when you got something wrong instead of hedging.

Do not assert that something is impossible without checking. That assertion has been wrong repeatedly on this project — Facebook competitor data (PPCA exists), Bright Data's Threads scraper (it exists), Instagram's post cap (it was the endpoint, not the platform).

## Open work

Priority order is at the end of `HANDOFF.md`. The largest gap versus Rival IQ is **scheduled exports**: PPT and CSV generated on a cron and emailed. Also outstanding:

- Twitter ingestion — 22 channels configured, never run. `/twitter/user/info` and `/twitter/user/tweets` on EnsembleData.
- Crons are off (`vercel.json` has an empty `crons` array) pending a decision on vendor spend.
- No tests exist. The first ones should cover `changePct` null behaviour, `safeDiv`, and the audience-is-a-stock rule.
- Audience history is one day deep, so all net-change reads render blank. Not a bug.
- `GBH News` has 380 posts belonging to no landscape. Needs a product decision, not a code fix.
- `src/lib/adapters/util/http.ts` is half dead code duplicated in `request.ts`. Fold them together.
