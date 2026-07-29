# EnsembleData: what it actually offers

Researched 29 July 2026 against the live API and the published docs, after
measuring the previous vendor at 76% success and a 44-second median call.

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
| Twitter | `/twitter/user/tweets` | 4 | Tweets with full engagement |
| Customer | `/customer/get-used-units` | 0 | Spend to date. Free to poll |

## Three findings that change the plan

### 1. A YouTube API key is no longer needed

EnsembleData covers YouTube completely, and separates Shorts from long-form
videos, which the official Data API does not do without inspecting each video's
duration. Two calls per channel replaces a Google Cloud project, an API key and
a 10,000 unit daily quota. The official API remains the better choice for owned
channels because it exposes impressions and watch time, which no scraper can
see.

### 2. Instagram reels need their own call, and that is where views live

`/instagram/user/posts` returns feed posts. `/instagram/user/reels` returns
reels, and only the reels response carries `play_count`. It also carries
`product_type: clips`, which is the only reliable way to distinguish a reel from
a feed video: the previous vendor reported `content_type: Video` for both and
`product_type: null`, which is why every Instagram post in this database is
stored with zero views and none is typed as a reel.

Both endpoints accept `oldest_timestamp`, so a window can be requested directly
rather than over-fetched and filtered client side.

### 3. Facebook is the only real gap

Facebook and LinkedIn are absent. Facebook competitor Pages therefore stay on
the previous vendor, which measured 42% success there, or wait for Page Public
Content Access. LinkedIn has no competitor read path from anyone at any price,
which is unchanged and not this vendor's fault.

## Cost at this landscape's size

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

## What to build, in order

1. Instagram on EnsembleData, feed and reels as separate calls, so views and
   reel typing stop being wrong. This is a correctness fix, not an addition.
2. YouTube on EnsembleData, which needs no key and lights up 23 channels.
3. Twitter on EnsembleData, which removes the $110 to $150 a month X API line
   unless owned-account impressions are wanted.
4. Retire the previous vendor everywhere except Facebook.
5. Surface unit spend in Settings from `/customer/get-used-units`.
