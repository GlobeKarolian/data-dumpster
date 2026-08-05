# EnsembleData: what it actually offers

Researched 29 July 2026 against the live API and the published docs, after
measuring the previous vendor at 76% success and a 44-second median call.

**Implementation update, 4 August 2026.** This endpoint inventory remains dated
evidence, not the operative source order. Bright Data is now primary for existing
Facebook and for Instagram, TikTok, X, Threads and LinkedIn whenever configured.
EnsembleData remains the Reddit publisher-user source, the synchronous X
onboarding helper, and the no-Bright fallback for Instagram, TikTok, X and
Threads. A paid Bright Data stage never falls through after it starts or fails.
YouTube stays on the official API and Bluesky on the public appview.

## Why this document exists

The first vendor was chosen from a comparison article and integrated endpoint by
endpoint as each gap appeared. That produced four adapters built against
whichever endpoint happened to be documented on the tutorial page, and two
avoidable mistakes: Instagram capped at twelve posts because the profile
endpoint was used instead of the discovery one, and Instagram reels stored with
no view count because the endpoint in question does not return one.

This is the inventory that should have come first.

## Coverage

Eight platforms: TikTok, Instagram, YouTube, Threads, Twitter/X, Reddit, Twitch,
Snapchat. Not Facebook. Not LinkedIn.

## Endpoints that matter for this product

| Platform | Path | Units | Returns |
|---|---|---|---|
| TikTok | `/tt/user/info` | 1 | Profile plus follower, heart and video counts |
| TikTok | `/tt/user/posts` | 1 per 10 | Videos with digg, comment, share, collect, play counts |
| Instagram | `/instagram/user/detailed-info` | 10 | Full profile and 12 most recent posts |
| Instagram | `/instagram/user/basic-info` | 4 | Username, followers, followings |
| Instagram | `/instagram/user/posts` | per post | Feed posts. Takes `oldest_timestamp` |
| Instagram | `/instagram/user/reels` | per post | Reels with `play_count`, `product_type: clips` |
| Instagram | `/instagram/user/followers` | 2 per 100 | Follower list |
| YouTube | `/youtube/channel/name-to-id` | 1 | Handle to browseId |
| YouTube | `/youtube/channel/detailed-info` | 2 | Channel metadata |
| YouTube | `/youtube/channel/followers` | 1 | Subscriber count |
| YouTube | `/youtube/channel/videos` | per video | Long-form videos |
| YouTube | `/youtube/channel/shorts` | per video | Shorts, separately from videos |
| Threads | `/threads/user/search` | 4 | Handle to numeric id, plus follower count |
| Threads | `/threads/user/posts` | per post | Posts with likes, replies, reposts, quotes |
| Twitter | `/twitter/user/info` | 2 | Profile and follower count |
| Twitter | `/twitter/user/tweets` | 4 | Twitter-selected profile highlights with engagement; not a chronological or complete timeline |
| Reddit | `/reddit/user/posts` | Not published; measure before broad rollout | User-account submissions, score, comments and crossposts; no user audience |
| Reddit | `/reddit/subreddit/posts` | 2 | Subreddit posts, score, comments, crossposts and current member count |
| Customer | `/customer/get-used-units` | 0 | Spend to date. Free to poll |

Both Reddit responses were verified live on 30 July 2026. Their actual envelope
is `{data:{nextCursor,posts:[{kind,data}]}}`; each observed page contained 25
rows, not a documented fixed page size. The currently published OpenAPI omits
`/reddit/user/posts`, but the route and its cursor were verified against
`u/bostonglobe`. `author_fullname` supplies stable user identity. It exposes no
user avatar or follower stock. `subreddit_subscribers` is the current member
stock of the community containing a post and must never become the author's
audience. `score` is Reddit's vote-fuzzed score, not a literal upvote count.
Neither feed exposes post views or saves.

## Three findings that change the plan

### 1. YouTube should stay on the official API. This corrects an earlier claim.

An earlier draft of this document said a YouTube API key was no longer needed.
That was written from the endpoint list rather than from a response body, and
testing shows it is wrong.

`/youtube/channel/videos` returns YouTube's raw InnerTube renderer shape, which
carries only:

    videoId, title, viewCountText "167 views", publishedTimeText "1 day ago",
    lengthText "1:22"

No likes. No comments. And a relative published time, which cannot be bucketed
into a 28-day window with any confidence once it reads "1 year ago". Real
engagement would need a `/youtube/video/details` call per video, roughly 690
extra units per full refresh.

The official Data API returns exact `publishedAt`, `viewCount`, `likeCount` and
`commentCount`, fifty videos per call, free, against a 10,000 unit daily quota.
Our existing adapter already uses it at about 3 units per 50 videos, so 23
channels cost roughly 70 units per refresh: about 140 free refreshes a day.

The lesson generalises. Endpoint inventories say what exists; only a response
body says what a field contains. Both Instagram bugs and this one came from
trusting the former.

### 2. Instagram reels need their own call, and that is where views live

`/instagram/user/posts` returns feed posts. `/instagram/user/reels` returns
reels, and only the reels response carries `play_count`. It also carries
`product_type: clips`, which is the only reliable way to distinguish a reel from
a feed video: the previous vendor reported `content_type: Video` for both and
`product_type: null`, which is why every Instagram post in this database is
stored with zero views and none is typed as a reel.

Both endpoints accept `oldest_timestamp`, so a window can be requested directly
rather than over-fetched and filtered client side.

### 3. EnsembleData does not cover Facebook or LinkedIn

That remains true about EnsembleData, not about the product or vendor market.
Existing Facebook profiles now use Bright Data, while future sanctioned Page
Public Content Access remains approval-gated. LinkedIn public company pages now
use Bright Data's company and company-post datasets. That path exposes follower
stock, posts, likes and comments only; it has no terminal history marker, so
every requested history window remains source-limited.

## Historical cost model at this landscape's size

The Silver plan is 11,000 units per day for $400 a month.

Per full refresh of 110 channels, assuming a 28-day window:

| Platform | Channels | Units each | Subtotal |
|---|---|---|---|
| TikTok | 24 | 1 + 6 | 168 |
| Instagram feed | 29 | 4 + 6 | 290 |
| Instagram reels | 29 | 3 | 87 |
| Threads | 22 | 4 + 3 | 154 |
| Twitter | 23 | 2 + 4 | 138 |
| YouTube | 23 | 1 + 2 + 4 | 161 |
| **Total** | **150** | | **~1,000** |

Roughly 1,000 units per complete refresh, so eleven full refreshes a day inside
the plan. Hourly refreshes of the whole landscape would need Gold. The
`/customer/get-used-units` endpoint costs nothing to poll, so actual spend
should be surfaced in Settings rather than estimated in a document.

## Current role in the source policy

1. Collect Reddit publisher-user feeds after Legal confirms the vendor agreement
   covers commercial use. Retained legacy subreddit rows remain readable, but new
   Reddit sources are user accounts.
2. Resolve X profiles synchronously during onboarding.
3. Collect Instagram, TikTok, X and Threads only when Bright Data is absent.
4. Never take over a live or failed paid Bright Data stage; resume its saved
   receipt or surface the failure.
5. Treat `/twitter/user/tweets` as selected Highlights, never a chronological
   timeline or certified window.
6. Surface unit spend from `/customer/get-used-units` when that product work is
   prioritized.
