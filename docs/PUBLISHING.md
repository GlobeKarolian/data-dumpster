# Publishing (prototype)

Data Dumpster's answer to losing SocialFlow at the end of 2026. It covers the
wish lists from the Globe and Boston.com social teams. The rest of Data
Dumpster provides the measurement layer (competitor landscape, post
performance, Adobe referrals).

Publishing is its own workspace at `/publish`, outside the analytics shell,
with three tabs: Posts, Calendar and Settings. RSS auto-post is switched off
(Oct 2026): the tab is hidden and the cron skips feed polling unless
`PUBLISHING_RSS=true`; the code and tables are kept. Pause posting and
New post (or press N) are always in the top bar.

The Posts screen is built for a desk under deadline, in plain language:

- One box at the top: "Paste a story link". Pasting fills the headline, image
  and the accounts used last time. When to post is one choice: Post now, Best
  time (next 2 hours, today, tonight, tomorrow) or Pick a time, and the box
  shows the actual time each account will post before anything is scheduled.
- Below it, one list of stories by day, with tabs for Scheduled, Posted,
  Drafts & review and Problems. Each story is one row with an icon and time
  per network.
- Clicking a story (here or on the Calendar) opens a side panel: per network,
  edit the text, change the time, post now or don't post there; cancel the
  whole post or share it again.
- Pause posting stops every send, RSS included. On resume, overdue posts are
  re-spaced by each account's minimum gap instead of firing together.
- RSS auto-post rules can be limited to RSS categories, can block keywords,
  and list what they did with each recent story.

## Safety switches

- **Test mode by default.** Unless `PUBLISHING_LIVE=true`, every send goes to the
  mock sender. Scheduling, slots, UTMs, approvals, and RSS all run
  for real; only the final network call is replaced.
- **Named users.** `/publish` and `/api/publishing/*` answer 404 to anyone
  outside `src/lib/publishing/access.ts` plus `PUBLISHING_EMAILS`.
- **Approval.** Admins and owners schedule directly and approve. Editors and
  viewers can only submit for approval, which is the co-op and new-staff
  training path. Feeds can also be set to hold every story for approval.
- **No double posts.** The dispatcher claims due sends with
  `FOR UPDATE SKIP LOCKED` and a lease. Ayrshare sends carry the delivery id as
  `idempotencyKey`. Bluesky has no idempotency, so a Bluesky send whose
  outcome is unknown fails with "check the account" instead of retrying.
- **Org-private.** Every table is `org_id` scoped. The only read of pooled data
  is a target's optional link to a tracked channel, which it uses to learn its
  best hours.

## How the asks map to the build

| Ask | Where |
| --- | --- |
| Schedule in a window and let the system pick the time | `slots.ts`, `performance.ts`. Each account picks the strongest hour in the window from its own last 120 days of engagement rate (median, shrunk, capped at 3x), then spaces posts by the account's minimum gap and daily cap. |
| Day-of-week rules with different hours per day | Posting hours per account, per weekday, multiple blocks per day, in Boston time (`zone.ts` handles DST). |
| Automatic platform-specific UTMs | `utm.ts`. A template per account, with placeholders. Tags already on a link are never overwritten. |
| One post across platforms with different UTMs | A post fans out to one delivery per account, each with its own copy, tagged link and slot. |
| Threads and Bluesky link without the URL in the text | Bluesky: done, via direct AT Protocol with a link card (`providers/bluesky.ts`). Threads: Ayrshare cannot do it. Threads' own API supports `link_attachment`, so it needs a direct Threads sender once our Meta app clears review for `threads_content_publish`. |
| Link in bio | Removed in October 2026. Instagram and TikTok posts carry no link. The old `publish_bio_*` tables are left in place, unused. |
| Instagram collab posts | Up to three collaborators, sent as Ayrshare `instagramOptions.collaborators`. |
| RSS autopublishing with custom copy per platform | `/publish/settings`. Templates per platform, a posting window, optional approval. Turning a feed on records its backlog rather than posting it. This is publishing from our own feeds, not RSS ingestion of competitors. |
| Approval workflow | Covered above. |
| Calendar view | `/publish/calendar`. |
| WordPress integration | Not built. A WordPress category feed (`/category/x/feed/`) covers autopublishing today. A plugin that sends from the post editor is the next step. |
| Nextdoor | Not possible through Ayrshare. Nextdoor's publishing API is partner-gated. It needs its own application. |

## Senders

- **Ayrshare** for Facebook, Instagram, Threads, X, LinkedIn and TikTok. Use one
  Business API key, plus one Profile-Key per brand stored encrypted on the
  account. X also needs our own X app keys. Request and response mapping is
  from Ayrshare's docs. Confirm it against a real response with the first test
  key (AGENTS.md: read the real response before trusting a mapper). Raw
  responses are kept in `publish_attempts.detail`.
- **Bluesky direct** with an app password per account.
- **Test only** (mock) for anything else.

## Going live, in order

1. Apply `drizzle/0039_publishing.sql` (the tables also self-create on first use).
2. Set `AYRSHARE_API_KEY` and connect one secondary brand (STAT or Boston.com)
   in Ayrshare. Add that brand's accounts in `/publish/settings` with its
   Profile-Key.
3. Link each account to its tracked channel so slots learn from history.
4. Run in test mode for a few days with the social team and compare the
   picked slots against what they would have chosen.
5. Set `PUBLISHING_LIVE=true` in a Preview deployment first, post to the
   secondary brand, then to production.

## Not yet built

- Media upload. Media is HTTPS URLs for now. Instagram and TikTok need one.
- Editing a queued post's copy. Today you cancel it and recompose.
- Slack alerts on failed sends. The existing Slack delivery can carry them.
- Post-send measurement. Join `publish_deliveries.provider_post_id` and
  `utm_content` to collected posts and Adobe referrals.
