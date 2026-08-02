# Scheduled jobs

Why each schedule is what it is, since a cron expression on its own explains nothing.

| Job | Schedule | maxDuration | Why |
|---|---|---|---|
| `/api/cron/ingest` | `*/10 * * * *` (every 10m) | 300s | Each invocation claims at most 24 durable profile jobs. Fresh profiles are not re-queued until they are three hours old, so the dispatcher frequency drains new landscapes and pagination without increasing the steady-state three-hour vendor cadence. |
| `/api/cron/alerts` | `20 * * * *` (hourly, :20) | 120s | Alerts are only useful if they arrive while the thing is still happening. Offset 20 minutes past the hour so an alert run never collides with an ingest run and reads a half-written window. Every finding is deduplicated on a stable key, so hourly evaluation over a multi-day window does not mean hourly notifications. |
| `/api/cron/brief` | `0 6 * * 1` (Mondays 06:00 UTC) | 300s | Before the first news meeting of the week. The brief covers the previous complete Monday-to-Sunday week, so it never mixes a partial week into a comparison. Generation is a model call plus a verification pass plus a possible repair turn, hence the ceiling. |
| `/api/cron/reports` | `10 * * * *` (hourly, :10) | 300s | Each enabled report schedule carries its own weekday, hour and IANA time zone. The hourly dispatcher catches the schedules whose local clock has passed and whose weekly delivery key has not run. A database uniqueness constraint prevents double delivery. |

`maxDuration` is declared as route segment config (`export const maxDuration`)
in each `route.ts` rather than in `vercel.json`. Route segment config is
authoritative for Next.js on Vercel, it lives next to the code whose runtime it
describes, and it cannot silently stop matching if a file moves -- a stale glob
in `vercel.json` fails the whole deploy.

All four verify `Authorization: Bearer $CRON_SECRET` in constant time and fail
closed if `CRON_SECRET` is unset. All four accept GET (what Vercel Cron sends)
and POST (what a human reaches for).

The ten-minute ingestion dispatcher is the required production schedule for
automatic landscape completeness, but `vercel.json` remains empty until its
recurring vendor spend is explicitly approved. Manual refreshes use the same
durable queue, so interrupted work resumes rather than disappearing. Every cron
route can still be exercised by hand with the bearer secret.
