# Scheduled jobs

Why each schedule is what it is, since a cron expression on its own explains nothing.

| Job | Schedule | maxDuration | Why |
|---|---|---|---|
| `/api/cron/ingest` | `0 */3 * * *` (every 3h) | 300s | Eight runs a day is frequent enough that a post is in Data Dumpster within a news cycle, and infrequent enough to stay inside the YouTube Data API's 10,000 free units per day across a landscape of this size. Engagement on social is not immutable, so each run also refreshes recent posts; three hours is roughly the interval at which those numbers have moved enough to be worth another call. |
| `/api/cron/alerts` | `20 * * * *` (hourly, :20) | 120s | Alerts are only useful if they arrive while the thing is still happening. Offset 20 minutes past the hour so an alert run never collides with an ingest run and reads a half-written window. Every finding is deduplicated on a stable key, so hourly evaluation over a multi-day window does not mean hourly notifications. |
| `/api/cron/brief` | `0 6 * * 1` (Mondays 06:00 UTC) | 300s | Before the first news meeting of the week. The brief covers the previous complete Monday-to-Sunday week, so it never mixes a partial week into a comparison. Generation is a model call plus a verification pass plus a possible repair turn, hence the ceiling. |

`maxDuration` is declared as route segment config (`export const maxDuration`)
in each `route.ts` rather than in `vercel.json`. Route segment config is
authoritative for Next.js on Vercel, it lives next to the code whose runtime it
describes, and it cannot silently stop matching if a file moves -- a stale glob
in `vercel.json` fails the whole deploy.

All three verify `Authorization: Bearer $CRON_SECRET` in constant time and fail
closed if `CRON_SECRET` is unset. All three accept GET (what Vercel Cron sends)
and POST (what a human reaches for).
