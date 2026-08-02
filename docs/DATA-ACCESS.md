# Data access: what Data Dumpster can actually see, what it costs, and what to do about it

**Audience:** CTO, CPO, and whoever signs the data contracts.
**Status:** current as of July 2026. Every figure is dated and sourced. Where I
am not confident, I say so in the line itself rather than in a footnote.

The short version: **the competitive social data market got materially worse
between 2024 and 2026, and the platforms that are open are not the platforms
that are large.** A newsroom competitive-intelligence product built in 2026 is
mostly an exercise in being honest about blind spots. Data Dumpster's differentiator
is not that it sees more than Rival IQ. It is that it tells you what it cannot
see instead of charting a zero.

**Correction, July 2026.** An earlier version of this document said Facebook
competitor data was unobtainable through sanctioned channels and unpurchasable at
any price. That was wrong. Meta's **Page Public Content Access** feature grants
exactly that access, through App Review. It is slow, conditional and revocable,
but it exists, and it should have been applied for in 2024. Section 2.1 is the
corrected account. The claims about the Meta Content Library, TikTok's Research
API and LinkedIn are unchanged and still hold.

---

## 1. The per-platform table

"Owned" means a channel we hold a token for. "Competitor" means any account we
do not control. That distinction is the entire story.

| Platform | Owned accounts | Competitor accounts | API | Cost | Approval burden | Rate limit |
|---|---|---|---|---|---|---|
| **Bluesky** | Full: posts, likes, replies, reposts, quotes, followers | **Full, identical to owned** | AT Protocol public appview, `public.api.bsky.app` | **$0** | **None.** No key, no application, no account | ~3,000 req / 5 min per IP (observed, not contractually documented) |
| **YouTube** | Full public stats + owner-only Analytics if we add OAuth | **Full public stats**: views, likes, comments, subscribers | Data API v3 | **$0** | Google Cloud project, enable one API. Minutes | 10,000 units/day per project. A channel refresh is ~3 units per 50 videos |
| **X / Twitter** | Everything incl. impressions | **Posts, likes, replies, retweets, quotes, bookmarks. No impressions** | API v2 | **Metered since Feb 2026**, reportedly ~$0.005 per post read, hard cap ~2M reads/mo. Legacy Basic ~$200/mo (~10k reads) and Pro ~$5,000/mo (~1M reads) closed to new signups; Basic subscribers migrated to metering from 1 June 2026. Enterprise from ~$42k/mo. **Confidence: medium — these come from secondary sources, not X's own page, and X has revised pricing repeatedly** | Developer account + payment. Days | Legacy Basic was 5 timeline requests / 15 min. Under metering the binding constraint is spend, not requests |
| **Instagram** | Full: posts, likes, comments, **saves, reach** | **Thin.** Followers, media count, and recent media with likes, comments, caption, permalink. Business/Creator accounts only. **No saves, no reach, no Stories, nothing for Personal accounts** | Graph API v21.0 `business_discovery` edge, queried through an IG account we own | **$0** beyond a Meta app | Meta app + App Review for `instagram_basic` and `instagram_manage_insights`. Weeks | Percentage-of-window model, not a call count. `x-app-usage` reports burn against a rolling hour |
| **Facebook** | Full: posts, reactions, comments, shares; impressions via a separate per-post insights call | **Public Page posts, reactions, comments and shares, once approved for Page Public Content Access.** No impressions, no reach, no saves | Graph API v21.0. Owned Pages via `/{page-id}/posts`; competitor Pages via `/{page-id}/feed` under PPCA | **$0** for both. PPCA costs review time, not money | Meta app + App Review for `pages_read_engagement` (owned). For competitors, App Review for **Page Public Content Access** plus business verification and possibly additional signed contracts. Weeks, and it can be refused | As Instagram. Meta publishes no PPCA-specific quota and recommends a system user token to avoid throttling |
| **TikTok** | Full: videos, views, likes, comments, shares, followers | **Nothing available to a commercial product** | Display API v2 for owned. Research API for competitors is academic/non-profit only | **$0** for owned | Owned: developer app + OAuth consent, days. Research API: written application, case-by-case review, **for-profit organisations are ineligible** | Not publicly guaranteed; revised without notice |
| **LinkedIn** | Full and unusually deep: impressions, clicks, likes, comments, shares, LinkedIn's own engagement rate, follower demographics | **Nothing, at any price** | Marketing API / Community Management API, versioned REST | **$0** for owned | Marketing Developer Platform or Community Management API application + review. **Weeks, and can be refused.** Tokens are 60-day member OAuth and must be refreshed | Per-app and per-member daily quotas, published per endpoint |
| **Threads** | Owned only | Nothing | Threads API | $0 | Meta app | — (no adapter yet) |
| **Reddit** | **Public user submissions**: score, comments and crossposts. No trustworthy user follower stock, views or saves | **Public subreddit posts**: the same post metrics plus current community member count | EnsembleData `/reddit/user/posts` and `/reddit/subreddit/posts` | Purchased vendor units; subreddit pages cost 2 units when verified 30 Jul 2026; user-page cost has not been measured | **Legal/vendor-contract review.** Reddit's current terms require permission and a contract for commercial use; a third-party vendor does not make that question disappear | Both feeds are cursor-paginated; 25 rows were observed per call, so do not assume a fixed page size |

Reddit is implemented through EnsembleData rather than Reddit's first-party Data
API. Before production collection, confirm in writing that the vendor agreement
covers this commercial use and that Boston Globe Media accepts the residual
platform-terms risk. The adapter is deliberately honest about the limits:
subreddit audience is the latest `subreddit_subscribers` stock, user-account
audience is blank, applause is the vote-fuzzed score, and view- or save-based
metrics are blank. The user endpoint was verified against `u/bostonglobe` on
30 July 2026. It returns `author_fullname` for stable identity but no user
profile image or follower count. A post's `subreddit_subscribers` belongs to
the community containing that post and is never used as the author's audience.
Current policy references: [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms)
and [Reddit's commercial-use guidance](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data).

### What is missing from every row

No platform except LinkedIn and owned Meta/TikTok gives us **impressions for
content we do not own.** That means `engagementRateByView` is undefined for
essentially every competitor, everywhere. Data Dumpster's headline comparability
metric is `engagementRateByFollower` precisely because it is the only rate that
can be computed for a competitor on more than one platform.

---

## 2. What the CrowdTangle shutdown did

CrowdTangle was retired on **14 August 2024**. Before that date, any newsroom
could watch any public Facebook Page and Instagram Business account: post
volume, reactions, comments, shares, and a usable "overperforming" score. It was
the single most important source of competitive social data in journalism, and
it was free.

It is gone. What replaced it is not one thing but two, and only one of them is
open to us.

### 2.1 Page Public Content Access is the sanctioned route, and it is real

**Correction to an earlier version of this document.** This file previously said
Facebook competitor data "does not exist and cannot be bought". That was wrong,
and it was wrong in the most expensive direction: it talked us out of an
application we should have started.

**Page Public Content Access (PPCA)** is a Meta App Review feature that is
current, documented, and grants exactly what we need. From Meta's own feature
reference:

> The **Page Public Content Access** feature allows an app access to the Pages
> Search API and to read public data for Pages for which you lack the
> **pages_read_engagement** permission and the **pages_read_user_content**
> permission. Readable data includes business metadata, public comments and
> posts. The allowed usage for this feature is to analyze and/or display posts
> and engagement on Pages.

Meta's Pages permissions and features page states the allowed usage more
directly still: **"to provide aggregated, anonymized public content for
competitive analysis and benchmarking."** Competitive analysis is not a use we
have to argue Meta into. It is the use Meta names.

| | Detail | Source |
|---|---|---|
| Endpoints unlocked | `/{page-id}/feed`, `/{page-post-id}`, `/{page-post-id}/comments`, plus the Pages Search API | Meta feature reference |
| Fields | Business metadata, public posts, public comments. Our field set (`id,message,created_time,permalink_url,full_picture,shares,comments.summary(true),reactions.summary(true)`) is the same one the owned path uses, so the numbers are directly comparable | Meta feature reference |
| Requires App Review | Yes, before the app can access live data | Meta feature reference |
| Requires business verification | Yes. Advanced access has required it since 1 February 2023 | Meta business verification doc |
| Additional contracts | "You may also need to sign additional contracts" | Meta feature reference |
| Before approval | The app can only read Pages whose admin also holds an admin, developer or tester role on the app. Once the app is Live it sees **no** Page public content without the feature | Meta feature reference |
| Rate limits | Meta publishes **no PPCA-specific quota**. Calls with an app or user token fall under the platform limit, "Calls within one hour = 200 * Number of Users" (unique daily active app users). Calls with a Page or system user token fall under the Pages business-use-case limit, "Calls within 24 hours = 4800 * Number of Engaged Users". Meta's rate-limit page explicitly recommends a **system user access token** to avoid throttling when using PPCA | Meta rate limits doc |

**Note what is not in that list.** I could not find any Meta documentation
stating that PPCA requires an architecture review, or naming news media
monitoring as an accepted or rejected use case. What Meta documents is App
Review, business verification, possible additional contracts, and separately a
Data Protection Assessment for maintaining data access over time. If someone
tells you an architecture review is a formal PPCA gate, ask them for the URL.

**Page Public Metadata Access** is the narrower predecessor: it gives the Pages
Search API and public `/page` fields such as like and follower counts, but not
the feed or comments. Meta's own documentation says it is superseded by PPCA and
that an app approved for PPCA cannot request it. Do not apply for both.

**The honest caveats**, because "it is possible" is not "it is easy":

- It is App Review, which in 2026 is reported to take around 20 days rather than
  the 10 the dashboard historically promised. That figure is from a third-party
  write-up, not Meta, so treat it as indicative.
- Rejections on restricted features are common and are usually about the
  demonstration, not the idea. The reviewer has to be able to test the feature
  in your live app. If they cannot, the whole submission fails.
- Once approved, the rate limits are strict enough that a competitor backfill has
  to be paced. The adapter caps competitor paging at five pages per run for this
  reason.
- Meta can revoke a feature. This is not a permanent asset.

`docs/META-PPCA-APPLICATION.md` is the practical guide to applying.

### 2.2 Meta Content Library is the research route, and it is closed to us

**Meta Content Library** is the research successor to CrowdTangle. What it does:

- Serves Facebook and Instagram public content, including Pages, with search
  and export.
- Is accessed through a hosted UI or a Python-only Content Library API.
- Is administered by ICPSR at the University of Michigan on Meta's behalf.

What it does **not** do, and this is the part that matters:

- **For-profit organisations are not eligible.** Eligibility is restricted to
  researchers affiliated with a qualified academic institution or a not-for-profit
  whose primary purpose is scientific or public-interest research. Boston Globe
  Media is a commercial company. It does not qualify.
- Journalists as a class lost access. CrowdTangle was open to newsrooms; the
  Content Library is not.
- Even for an eligible researcher, the terms and the access pattern make it
  unusable as a backing store for an operational product. It is a research
  environment, not an API you point a cron job at.

The Content Library matters for one thing only: it is where the CrowdTangle-era
archive lives, and that archive is genuinely unavailable to us. PPCA gets us
Facebook data from the day we are approved forward. It does not get us history.

**The practical consequence for Data Dumpster:** Facebook competitor data is
obtainable through PPCA, on a timeline measured in weeks and conditional on
passing App Review. Until then Facebook is owned-only and the product says so.
Instagram competitor data is separate and unaffected: PPCA is a Pages feature and
grants nothing on Instagram, so Instagram competitors still come only from the
Graph `business_discovery` edge, which returns a thin public subset and which
Meta has never committed to maintaining. All three paths are implemented in
`src/lib/adapters/meta.ts` and the adapter's `accessNotes` say so in the UI.

There is a European angle worth knowing about but not counting on: the Digital
Services Act Article 40 vetted-researcher pathway came into force in late 2025
and compels very large platforms to give vetted EU researchers data access. It
does not help a US commercial newsroom, and it is not a product route.

---

## 3. What X actually costs now

X changed its model in **February 2026**, moving from subscription tiers to
metered credits. My understanding of the current shape, from secondary sources
rather than X's own pricing page:

| Model | Price | What you get |
|---|---|---|
| Free | discontinued for reads | — |
| Pay-per-use (default for new developers) | ~$0.005 per post read, ~$0.015 per post created | Hard ceiling around 2,000,000 reads/month |
| Basic (legacy, closed) | ~$200/month | ~10,000 posts read/month, project-wide |
| Pro (legacy, closed) | ~$5,000/month | ~1,000,000 posts read/month |
| Enterprise | from ~$42,000/month | SLA, dedicated support, volume |

**Confidence: medium.** These numbers are consistent across several independent
2026 write-ups but I have not verified them against X's own portal, and X has
revised pricing at least three times since 2023. **Do not sign anything off this
table. Log into the developer portal and read the current rate.**

### What that means in practice for a newsroom landscape

The metered model is, counter-intuitively, *better* for us than Basic was. The
cost is proportional to what we read rather than a flat fee against a cap we
would blow through.

Worked example, one landscape of 12 competitor X accounts averaging 25 posts a
day:

| Strategy | Reads/month | Cost/month at $0.005 |
|---|---|---|
| New posts only, never refresh engagement | ~9,000 | **~$45** |
| New posts + refresh the trailing 3 days daily | ~36,000 | **~$180** |
| New posts + refresh the trailing 7 days daily | ~72,000 | **~$360** |
| Refresh a 30-day window daily (naive) | ~270,000 | **~$1,350** |

This is exactly why `src/lib/adapters/twitter.ts` keeps a `since_id` high-water
mark on the channel cursor, excludes retweets, and never pages speculatively.
The default two-day refresh overlap in the runner puts us near the second row.
**The refresh window is the single biggest cost lever in this system.** It is a
constant in `runner.ts` and it should be a per-platform setting before this goes
to production.

Also note: `impression_count` is only populated for the authenticating account.
Every competitor X channel has views of 0, and that is "unknown", not "nobody
saw it".

---

## 4. Why Bluesky and YouTube are the highest-leverage official sources

These two are the backbone. Not because they are the biggest platforms, but
because they are the only ones where **the data we get for a competitor is
identical to the data we get for ourselves.** That is the precondition for an
honest comparison, and it is rarer than it should be.

**Bluesky.** No key. No application. No account. `public.api.bsky.app` serves
full post and follower data for any public account, and the protocol is designed
so that this remains true. Likes, replies, reposts and quotes all come back;
only impressions and bookmarks are missing, and they are missing for everyone
including the author, so no one has an advantage. For a newsroom this is a
structural gift: a full competitive landscape can be stood up in an afternoon
with zero procurement. Bluesky is also where a large share of journalism-adjacent
audience moved after 2024, which makes it strategically important as well as
technically convenient.

**YouTube.** A free Data API key reads any public channel's views, likes,
comments and subscriber count. 10,000 units a day is generous: a channel refresh
costs about three units per fifty videos, so a landscape of twenty competitors
refreshed hourly is well inside the free quota. The gap is share counts, removed
from the API years ago, and impressions, which are owner-only. We report 0 and
label it "not available on YouTube" rather than pretending it is zero.

**The strategic read:** build the official-API core on these two, treat X and
purchased public-data vendors as metered supplements, and get the PPCA
application in so Facebook joins the comparable set. Data Dumpster deliberately
does not ingest RSS; posted-URL analysis connects social activity back to the
journalism without creating a second publishing dataset.

---

## 5. How Rival IQ likely sources this

**This section is inference. I have no inside knowledge of Rival IQ's
architecture or contracts. It is reasoned from what their product shows, what
the APIs permit, and what changed in 2024. Treat every claim here as a
hypothesis.**

**Owned channels: customer OAuth.** Rival IQ asks customers to connect their own
Facebook Pages, Instagram Business accounts, LinkedIn pages and TikTok accounts.
This is almost certainly how they get saves, reach, impressions and click data
for the customer's own channels. Same mechanism as ours; there is no other one.

**Instagram competitors: Business Discovery.** Their Instagram competitor
metrics are limited to followers, posts, likes and comments — exactly the
`business_discovery` field set, and exactly what is missing is what that edge
omits. High confidence in this inference.

**Facebook competitors: most likely PPCA.** Rival IQ was a CrowdTangle-era
product and lost that feed like everyone else. But a company whose entire product
is competitive benchmarking, with a verified business and a decade-old Meta app,
is close to the archetypal PPCA applicant, and Meta names competitive analysis
and benchmarking as the allowed usage. The most likely explanation for their
current Facebook competitor reporting is a PPCA grant plus the pre-August-2024
archive for history. **Medium confidence, revised from "they lost this too",
which was based on the incorrect assumption that PPCA was closed.**

**X: a paid enterprise relationship.** They serve a lot of customers a lot of X
data. At retail metered rates that would be enormous; at Enterprise rates with
volume terms it is a line item. My guess is an Enterprise contract, possibly via
a reseller. **Medium confidence.**

**TikTok: unclear, and worth asking them directly.** The Research API bars
commercial use, and the Display API only reads owned accounts. Either they have
a commercial agreement that is not publicly documented, they buy from a
third-party vendor, or their TikTok competitor data is thinner than it looks.
**Low confidence. If we are ever in a bake-off, this is the question to ask.**

**The real moat is history.** Rival IQ has been collecting since roughly 2013.
Their genuine advantage is not access, it is that they have a decade of stored
competitor time series that nobody can retroactively reconstruct — including
Facebook data from the CrowdTangle era that no longer exists anywhere else.
**This is the thing we cannot replicate, and we should not pretend otherwise.**
What we can do is start our own clock now, and be better on everything else.

**What this means for us:** we are not structurally disadvantaged on data
access. On the platforms that matter for a 2026 newsroom, we can see the same
things they can. Where we can win is honesty about the gaps, bring-your-own-model
AI, and newsroom-native analysis they have no reason to build.

---

## 6. Recommended acquisition strategy for Boston Globe Media

### Pay for

**X, on the metered plan.** It is the only paid source that returns genuinely
comparable competitor data, and metering makes the spend controllable. Budget
**$150 to $400 a month** for a landscape of a dozen competitor accounts with a
three-day engagement refresh window. Start at a two-day window, watch the actual
read count in `ingestion_runs.api_calls`, and tune from there. Do not buy a
legacy tier even if offered one; the cap is the trap.

**Nothing else, initially.** There is no second paid source worth the money
until we have run the free ones for a quarter and know what is actually missing.

### Cover with owned tokens

Connect Globe Media's own accounts and get the deep owned-channel data that
competitors cannot see about us either:

- **Facebook Pages** — Globe, Boston.com, STAT. `pages_read_engagement`.
- **Instagram Business** — same brands. Also supplies the querying account for
  competitor `business_discovery` lookups, so this one is load-bearing twice.
- **LinkedIn organization pages** — the richest owned data of any platform here:
  impressions, clicks, and LinkedIn's own engagement rate. Start the Marketing
  Developer Platform application early; it takes weeks and can be refused.
- **TikTok** — Display API OAuth per account. Note that TikTok access tokens
  last 24 hours; the adapter refreshes them automatically, but the refresh token
  must be stored.
- **YouTube** — the public key covers competitors. Adding owner OAuth for our
  own channels would additionally unlock shares and impressions via YouTube
  Analytics. Worth doing in phase two.

### Apply for, starting now

**Page Public Content Access.** This is free, it is the only sanctioned route to
Facebook competitor data, and the cost is calendar time. Start it in week one,
because the clock does not run until the submission is in. The prerequisites are
a Meta app in Live mode, a verified Business, a privacy policy URL, and a working
Facebook competitor feature the reviewer can actually test. The adapter is built;
what remains is the review. `docs/META-PPCA-APPLICATION.md` has the detail.

Do not apply for Page Public Metadata Access alongside it. Meta's documentation
says PPCA supersedes it and that an app requesting or holding PPCA cannot request
the metadata feature.

### Accept as blind spots

Label these in the product. Do not fill them with estimates.

- **Facebook competitors until PPCA is granted.** This one is temporary and it is
  our own timeline, not a platform limitation. Label it as pending review, not as
  impossible. If review is refused, it becomes a real blind spot and the fallback
  is section 9.1 of `DATA-VENDORS.md`.

- **TikTok competitors.** The official commercial APIs do not provide the
  competitive view this product needs. Purchased public-data vendors can fill
  part of the gap, but the UI must name the source and its completeness limits.
- **LinkedIn competitors.** Official access is for owned pages. Competitor
  coverage requires a purchased public-data vendor and must be treated as
  incomplete rather than equivalent to owned analytics.
- **Impressions for anyone else's content, everywhere.** Structural.
- **Instagram competitor saves, reach and Stories.** Business Discovery does not
  serve them.

### Estimated monthly data cost

| Line item | Monthly | Confidence |
|---|---|---|
| Bluesky | $0 | High |
| YouTube Data API | $0 | High |
| Meta Graph API, owned + IG discovery | $0 | High |
| LinkedIn Marketing API, owned | $0 | High |
| TikTok Display API, owned | $0 | High |
| X API, metered, 12 competitors, 3-day refresh | **~$180** | Medium — depends entirely on X's current rate and our refresh window |
| **Total data acquisition** | **~$180/month** | Medium |

Infrastructure is separate and small: Neon Postgres and Vercel for a workload
this size land in the tens of dollars a month, plus whatever the org already
spends on the inference endpoint it points Data Dumpster at. Bring-your-own-model
means AI cost is the org's existing contract, not a markup.

**For comparison**, Rival IQ's published plans have historically run from
roughly $240 to roughly $560 a month per seat-tier, though I have not verified
2026 pricing and they quote enterprise separately. **Low confidence on the
current number.** The point is not that we are cheaper. The point is that the
data acquisition cost of running this system is small enough that it is not a
reason to buy instead of build; the reasons to build are control of the AI, the
honesty of the numbers, and the newsroom-specific analysis.

---

## 7. Engineering consequences already baked in

Things in the code that exist because of the above, listed so nobody
"simplifies" them later:

- **`registry.ts` exports `OWNED_ONLY_PLATFORMS` and `isOwnedOnly`.** The UI
  must use these to keep TikTok and LinkedIn out of competitor comparisons
  rather than charting them as zero. Facebook is in that map too, but
  conditionally: `isOwnedOnly('facebook', credentials)` returns false once the
  org sets `ppcaApproved`, which is the one entry in the map that describes
  paperwork rather than an API limit.
- **Every adapter carries `accessNotes`** and Settings renders it. If a platform
  cannot answer a question, the person configuring it finds out then, not from a
  confusing chart three weeks later.
- **The runner injects `cursor.__isOwned`** so the Facebook, Instagram, TikTok
  and LinkedIn adapters can pick an owned or competitor read path, and strips
  double-underscore keys before persisting the cursor. On Facebook that flag
  chooses between `/{page-id}/posts` with the Page token and `/{page-id}/feed`
  with the PPCA token.
- **`views` of 0 means "not exposed", never "no views"**, on YouTube, Bluesky,
  Facebook, and competitor X and Instagram. `engagementRateByView` is stored as
  NULL rather than 0 when views are 0, so the metrics layer can tell the
  difference.
- **The X adapter uses `since_id`, excludes retweets, and caps pages.** Each of
  those is money.
- **The refresh overlap window in `runner.ts` is the main cost dial.** It is
  currently a two-day constant. It should become a per-platform setting before
  production.

## 8. Environment variables

`.env.example` documents the platform credentials. Three additional variables
are read by the runner and should be added to it:

- `META_IG_USER_ID` — the Instagram Business account id our token belongs to.
  Required for competitor Business Discovery lookups, not just for reading our
  own account.
- `TIKTOK_ACCESS_TOKEN` and `TIKTOK_REFRESH_TOKEN` — per-account OAuth tokens.
  Per-org credentials in Settings are the better home for these; the environment
  fallback exists for single-org deployments.

The two Facebook PPCA credentials are deliberately per-org only and have no
environment fallback, because "is this organisation approved for PPCA" is a fact
about an organisation, not about a deployment:

- `ppcaApproved` — set to `true` only once Meta App Review has actually granted
  the feature. Until then, competitor Facebook channels fail with an explanation
  rather than returning an empty result.
- `ppcaAccessToken` — the token used to read Pages we do not administer. Meta
  recommends a system user access token here specifically to avoid rate limiting.
  Falls back to the main Page token if blank.

Per-org credentials stored in `platform_credentials` always win over the
environment. They are AES-256-GCM encrypted at rest by `src/lib/crypto.ts`, and
the runner skips and warns about a credential it cannot decrypt rather than
failing the whole batch.

---

## Sources

- Page Public Content Access, fetched July 2026:
  [Meta feature reference](https://developers.facebook.com/docs/features-reference/page-public-content-access/),
  [Pages permissions and features](https://developers.facebook.com/docs/pages/overview/permissions-features),
  [Page Public Metadata Access, the superseded predecessor](https://developers.facebook.com/docs/features-reference/page-public-metadata-access/)
- App Review, business verification and rate limits:
  [App Review overview](https://developers.facebook.com/docs/app-review),
  [Screen recordings](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/),
  [Business verification](https://developers.facebook.com/docs/development/release/business-verification),
  [Graph API rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting)
- Current Graph API version, v25.0, released 18 February 2026:
  [Meta for Developers blog](https://developers.facebook.com/blog/post/2026/02/18/introducing-graph-api-v25-and-marketing-api-v25/),
  [v25.0 changelog](https://developers.facebook.com/docs/graph-api/changelog/version25.0/)
- CrowdTangle shutdown and Meta Content Library eligibility:
  [Meta Transparency Center](https://transparency.meta.com/researchtools/other-data-catalogue/crowdtangle/),
  [Meta Content Library FAQs](https://socialmediaarchive.org/pages/?page=Meta+Content+Library+FAQs&ln=en),
  [Columbia Journalism Review](https://www.cjr.org/tow_center/meta-is-getting-rid-of-crowdtangle.php),
  [Tech Policy Press](https://www.techpolicy.press/researchers-consider-the-impact-of-metas-crowdtangle-shutdown/)
- X API pricing, February 2026 metering change (secondary sources, unverified
  against X's own portal):
  [Blotato](https://www.blotato.com/blog/twitter-api-pricing),
  [Postproxy](https://postproxy.dev/blog/x-api-pricing-2026/),
  [Xpoz](https://www.xpoz.ai/blog/guides/understanding-twitter-api-pricing-tiers-and-alternatives/)
- TikTok Research API eligibility:
  [TikTok for Developers](https://developers.tiktok.com/products/research-api/),
  [TikTok Newsroom](https://newsroom.tiktok.com/expanding-tiktoks-research-api-and-commercial-content-library?lang=en-150)
