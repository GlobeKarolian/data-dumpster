# Scheduled jobs

`vercel.json` is the source of truth for active schedules. Recurring collection
is active because stale public feeds and missed audience stocks make weekly
comparison unusable. Vercel evaluates cron expressions in UTC.

## Active collection schedules

| Job | Active schedule | maxDuration | Why |
|---|---|---|---|
| `/api/cron/refresh` | `*/10 * * * *` (every ten minutes) | 60s | Reserves and wakes at most one existing coordinator whose retry or lost dispatch is due. It creates no new landscape demand and cannot start an estate crawl. |
| `/api/cron/ingest?mode=scheduled&limit=250&postLimit=500` | `0 0,12 * * *` (00:00 and 12:00 UTC) | 300s | Opens the only two routine freshness windows each day, reconciles the tracked estate and begins collection. |
| `/api/cron/ingest?mode=recover&limit=250&postLimit=500` | `5,15,25,35,45,55 * * * *` | 300s | Drains continuations, paid receipts and retries already in the queue. Recovery mode cannot make fresh profiles due or create a third normal refresh. |

Audience is a stock: a missing follower snapshot cannot be reconstructed after
the day closes. The twice-daily windows capture morning and evening readings;
the recovery ticks exist because vendor receipts and retries may outlive one
five-minute serverless invocation.

The refresh recovery route is intentionally separate from estate ingestion. A
normal coordinator self-chains ten-profile waves immediately. The ten-minute
route exists only to recover a lost chained invocation or to wake work after its
backoff becomes eligible. It atomically advances the selected job's next-wake
time before dispatch and handles only one job, preventing repeated failures or
separate serverless processes from multiplying vendor concurrency.

The ingest route first writes each landscape's exact channel/window requirement
to `landscape_channel_demands`, pools those windows into one
`channel_collection_state` per channel, then claims at most 250 rows with `FOR
UPDATE SKIP LOCKED`. A state row cannot be claimed without a live demand. A new
profile requests 90 days; a settled profile refreshes a two-day overlap and is
not due again for twelve hours. Up to ten network-bound workers run behind
per-platform rate gates. A six-minute lease makes a killed invocation recoverable
by a later one.

Source and scheduler outcomes are deliberately separate from display status:

- certified complete windows merge into durable coverage;
- a real cursor continues immediately;
- a selected feed or cursorless cap records a terminal source limitation and
  stops automatic paid retry;
- operational failures back off; and
- permanent failures wait for operator action.

After an adapter responds and before any observation write, the worker
normalizes and claims the fetched stable platform id. A blank, changed or
already-claimed id is a permanent operator-review outcome: no observations are
written and the runner never merges histories automatically.

`attemptedUntil` advances on settled source responses even when coverage remains
uncertified. This lets a limited source refresh recent facts with the normal
two-day overlap without buying the same unavailable 90-day history every run.

`maxDuration` is declared as route segment config (`export const maxDuration`)
in each `route.ts`. It is listed here for operators, but the route file is
authoritative for the runtime ceiling.

`npm run ingest:once` uses this same demand, claim and lease path. Its
`--dry-run` mode stops after a read-only target preview: it registers no demand,
makes no vendor call and writes nothing. There is no manual direct-crawl escape
hatch around the scheduler.

## Other implemented routes (inactive)

These authenticated routes also exist but are not declared in `vercel.json`:

- `/api/cron/alerts`: evaluates and deduplicates alert rules, records events and
  makes best-effort Slack notifications. Alert delivery has no report-style
  destination audit.
- `/api/cron/brief`: generates the previous complete Eastern week only when the
  fact-sheet verifier passes; failed prose is not saved.
- `/api/cron/reports`: dispatches enabled IANA-zone schedules through the durable
  per-destination delivery audit for email and tenant-bound Slack.

The audience coverage route remains implemented but inactive. All routes in
this document can be exercised manually. Activating any inactive route is an
operating decision about vendor spend, notification or delivery behavior and
requires a reviewed matching `vercel.json` entry.

Every cron route verifies `Authorization: Bearer $CRON_SECRET` in constant time
and fails closed if `CRON_SECRET` is unset. The routes accept GET, which Vercel
Cron sends, and POST for manual operation.

Cron expressions are UTC, but product windows are not ambient-UTC. Analytics and
brief periods use explicit `America/New_York` helpers; report schedules use their
stored IANA zone. The deployment process's `TZ` setting is irrelevant.

Monitor `/api/health` as well as route success. A 200 response can be
`degraded` when an active demanded channel has no certified coverage in the last
24 hours or a closed audience day is incomplete. Orphan active channels do not
enter the denominator. Attempt freshness still appears as
`lastSuccessfulIngestAt`, but a terminal source limitation remains overdue
without certified `coverageUntil`. Only database failure returns 503. Today
remains open until Eastern midnight and is excluded from the closed-day
degradation check.
