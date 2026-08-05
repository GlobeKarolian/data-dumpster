# Data access: what Data Dumpster can actually see, what it costs, and what to do about it

**Audience:** CTO, CPO, and whoever signs the data contracts.
**Status:** current as of 4 August 2026. Every figure is dated and sourced. Where I
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
corrected account. The official-access limits for the Meta Content Library,
TikTok's Research API and LinkedIn still hold; the implemented purchased-source
routing is now recorded separately below.

**Status update, 3 August 2026.** Boston Globe Media's Tech Provider Access
Verification is verified. Meta treats that verification as independent of App
Review and access levels, so it does not evidence PPCA production approval. The
available records do not establish PPCA's production status, the app remains
unpublished, and the App Review submission/decision state must be read from
Meta's dashboard rather than inferred from Access Verification.

---

## 1. The per-platform table

"Owned" means a channel we hold a token for. "Competitor" means any account we
do not control. That distinction is the entire story.

| Platform | Owned accounts | Competitor accounts | API | Cost | Approval burden | Rate limit |
|---|---|---|---|---|---|---|
| **Bluesky** | Full: posts, likes, replies, reposts, quotes, followers | **Full, identical to owned** | AT Protocol public appview, `public.api.bsky.app` | **$0** | **None.** No key, no application, no account | ~3,000 req / 5 min per IP (observed, not contractually documented) |
| **YouTube** | Full public stats + owner-only Analytics if we add OAuth | **Full public stats**: views, likes, comments, subscribers | Data API v3 | **$0** | Google Cloud project, enable one API. Minutes | 10,000 units/day per project. A channel refresh is ~3 units per 50 videos |
| **X / Twitter** | Official owner access can include impressions, but owner credentials are excluded from pooled rows | **Bright Data when configured; otherwise EnsembleData's selected Highlights feed.** Public profile and engagement facts are useful, but neither observed source has certified an exact requested timeline | Current pooled source: Bright Data, with EnsembleData for synchronous onboarding and no-Bright collection. Official API v2 is not the pooled route | Purchased-source units | Legal/procurement approval and spend controls | A paid Bright stage never falls through to EnsembleData. EnsembleData Highlights are always source-limited |
| **Instagram** | Official owner access can include saves and reach, but owner credentials are excluded from pooled rows | **Bright Data when configured; EnsembleData only when Bright Data is absent.** Public account and media fields; no public saves or reach | Current pooled source: Bright Data or no-Bright EnsembleData fallback. Meta owner and Business Discovery credentials are excluded from pooled work | Purchased-source units | Legal/procurement approval and vendor retention/provenance review | A started or failed Bright stage never changes vendor |
| **Facebook** | Full: posts, reactions, comments, shares; impressions via a separate per-post insights call | **Currently purchased through Bright Data, with explicit completeness status.** The sanctioned first-party route is public Page posts, reactions, comments and shares after PPCA approval. No impressions, reach or saves | Current pooled source: Bright Data. Future approved source: Graph API `/{page-id}/feed` under PPCA. Owned Graph reads are isolated from pooled rows | Purchased-source units today; Graph calls are $0 after approval. PPCA costs review time, not API fees | PPCA App Review plus business verification and possibly additional contracts. Tech Provider Access Verification is verified but does not satisfy this gate | Meta publishes no PPCA-specific quota and recommends a system user token to avoid throttling; Bright Data has separate spend and snapshot limits |
| **TikTok** | Official owner access is available, but owner credentials are excluded from pooled rows | **Bright Data when configured; EnsembleData only when Bright Data is absent.** Public videos, views and engagement | Current pooled source: Bright Data or no-Bright EnsembleData fallback. The Research API does not permit this commercial use | Purchased-source units | Legal/procurement approval; official Research access is not a commercial product path | A started or failed Bright stage never changes vendor |
| **LinkedIn** | Official owned analytics can include impressions, clicks, shares and demographics, but admin credentials are excluded from pooled rows | **Bright Data company and company-post datasets:** follower stock, posts, likes and comments | Current pooled source: Bright Data. Official Marketing and Community Management APIs remain owned-only | Purchased-source units | Legal/procurement approval; owned support also requires organization-private storage and verified bindings | No public shares, saves, views, reach or impressions. The cursorless source has no exhaustion marker, so history is always source-limited |
| **Threads** | The official API is owned-only and owner credentials are excluded from pooled rows | **Bright Data when configured; EnsembleData only when Bright Data is absent.** Public posts, engagement and audience | Current pooled source: Bright Data or no-Bright EnsembleData fallback | Purchased-source units | Legal/procurement approval | A started or failed Bright stage never changes vendor |
| **Reddit** | **Public publisher-user submissions**: score, comments and crossposts. No trustworthy user follower stock, views or saves | The same publisher-user feed; retained legacy subreddit rows remain readable but new sources are user accounts | EnsembleData `/reddit/user/posts` | Purchased vendor units; user-page cost has not been measured | **Legal/vendor-contract review.** Reddit's current terms require permission and a contract for commercial use; a third-party vendor does not make that question disappear | The user feed is cursor-paginated; observed pages contained 25 rows, so do not assume a fixed page size |

Reddit publisher-user collection is implemented through EnsembleData rather than
Reddit's first-party Data API. Before production collection, confirm in writing
that the vendor agreement covers this commercial use and that Boston Globe Media
accepts the residual platform-terms risk. The adapter is deliberately honest
about the limits: user-account audience is blank, applause is the vote-fuzzed
score, and view- or save-based metrics are blank. The user endpoint was verified
against `u/bostonglobe` on 30 July 2026. It returns `author_fullname` for stable
identity but no user profile image or follower count. Retained legacy subreddit
rows may contain `subreddit_subscribers`; that stock belongs to the community
and is never used as the author's audience.
Current policy references: [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms)
and [Reddit's commercial-use guidance](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data).

### What is missing from every row

No current public competitor source gives us **impressions for content we do not
own.** LinkedIn's public Bright Data path is limited to follower stock, posts,
likes and comments; its deeper official analytics are owner-only. That means
`engagementRateByView` is undefined for essentially every competitor, everywhere.
Data Dumpster's headline comparability metric is `engagementRateByFollower`
precisely because it is the only rate that can be computed for a competitor on
more than one platform.

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
  in the submitted review build. Before approval, use only controlled Pages
  whose administrators are app-role users. If the path is not reproducible, the
  submission fails.
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
passing App Review. Until then the pooled runner buys public Facebook data from
Bright Data and records its completeness; it does not use an owner token or a
PPCA token. Instagram competitor data is separate and unaffected: PPCA is a
Pages feature and grants nothing on Instagram. Instagram Public Content Access
is hashtag search only, not arbitrary competitor-account timelines.

There is a European angle worth knowing about but not counting on: the Digital
Services Act Article 40 vetted-researcher pathway came into force in late 2025
and compels very large platforms to give vetted EU researchers data access. It
does not help a US commercial newsroom, and it is not a product route.

---

## 3. Official X API cost research (not the current pooled route)

Data Dumpster currently collects X through Bright Data when configured and
through EnsembleData only when Bright Data is absent; EnsembleData remains the
synchronous onboarding helper in either case. Both live exact-window tests were
source-limited. The official API figures below are retained as dated acquisition
research, not as the application's operative routing or cost model.

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

### What the official option would mean for a newsroom landscape

If BGM chooses the official API later, its cost would be proportional to what we
read rather than a flat fee against a cap we would blow through.

Worked example, one landscape of 12 competitor X accounts averaging 25 posts a
day:

| Strategy | Reads/month | Cost/month at $0.005 |
|---|---|---|
| New posts only, never refresh engagement | ~9,000 | **~$45** |
| New posts + refresh the trailing 3 days daily | ~36,000 | **~$180** |
| New posts + refresh the trailing 7 days daily | ~72,000 | **~$360** |
| Refresh a 30-day window daily (naive) | ~270,000 | **~$1,350** |

This table would make the refresh window the main cost lever for an official X
integration. It does not describe spend by the current Bright Data or
EnsembleData paths; measure those from ingestion audits and vendor billing.

Also note: official `impression_count` is only populated for the authenticating
account. Every public source must carry missing metric availability explicitly;
an absent view or impression count is unknown, not measured zero.

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

**The strategic read:** keep the official public core on these two, treat every
purchased source as an approved, metered dependency, and get the PPCA
application in as a possible future Facebook source. Data Dumpster deliberately
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
for the customer's own channels. It is the mechanism Data Dumpster's future
owned-native stream would require; the current pooled runner excludes those
credentials.

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

### Approve the implemented public-source stack

- **Bright Data** is the existing-Facebook source and the configured primary for
  Instagram, TikTok, X, Threads and LinkedIn.
- **EnsembleData** remains the Reddit publisher-user feed, X onboarding helper,
  and no-Bright fallback for Instagram, TikTok, X and Threads.
- **YouTube and Bluesky** remain on sanctioned public interfaces.
- **No paid-stage failover:** once a Bright Data stage starts, its receipt is
  resumed. A failed paid stage does not switch vendors and risk a second charge.

Every purchased path needs a recorded Legal/procurement decision, spend controls
and source provenance. LinkedIn public coverage is deliberately narrow:
followers, posts, likes and comments only, with history always source-limited.

### Future owned-native work, outside pooled collection

Owner tokens can unlock deeper first-party data, but they are excluded from the
pooled runner until organization-private observations and verified credential
bindings exist:

- **Facebook Pages** — Globe, Boston.com, STAT. `pages_read_engagement`.
- **Instagram Business** — same brands, for owned-native insights only.
- **LinkedIn organization pages** — the richest owned data of any platform here:
  impressions, clicks, and LinkedIn's own engagement rate. Start the Marketing
  Developer Platform application early; it takes weeks and can be refused.
- **TikTok** — Display API OAuth per account, after private storage and binding
  gates are complete.
- **YouTube** — the public key covers competitors. Adding owner OAuth for our
  own channels would additionally unlock shares and impressions via YouTube
  Analytics. Worth doing in phase two.

### PPCA application status and next work

**Page Public Content Access.** This is free, it is the only sanctioned route to
Facebook competitor data, and the cost is calendar time. Tech Provider Access
Verification is verified, but that is independent of App Review and grants no
PPCA access. Confirm the current App Review state in Meta's dashboard. Prepare a
testable app, a 1024-pixel icon, business verification, privacy and data-handling
answers, one recent successful call and one distinct 1080p recording per
requested item. Submit while the app remains in Development mode; switch to Live
only after approval and production validation. `docs/META-PPCA-APPLICATION.md`
is the authoritative checklist.

Do not apply for Page Public Metadata Access alongside it. Meta's documentation
says PPCA supersedes it and that an app requesting or holding PPCA cannot request
the metadata feature.

### Accept as blind spots

Label these in the product. Do not fill them with estimates.

- **First-party Facebook coverage until PPCA is granted.** Public competitor
  coverage currently comes from Bright Data and must retain the vendor's
  completeness warning and provenance. Label the official Meta source as
  unavailable, not the entire Facebook platform as empty. Bright Data remains
  the approved current source for existing profiles unless policy changes.

- **TikTok competitors.** The official commercial APIs do not provide the
  competitive view this product needs. Purchased public-data vendors can fill
  part of the gap, but the UI must name the source and its completeness limits.
- **LinkedIn competitors.** Official access is for owned pages. Competitor
  coverage requires a purchased public-data vendor and must be treated as
  incomplete rather than equivalent to owned analytics.
- **Impressions for anyone else's content, everywhere.** Structural.
- **Instagram competitor saves, reach and Stories.** Business Discovery does not
  serve them.

### Data-cost accounting

| Source | Cost treatment |
|---|---|
| Bluesky public appview | $0 |
| YouTube Data API | $0 within quota |
| Bright Data | Measure actual snapshot/record spend across Facebook, Instagram, TikTok, X, Threads and LinkedIn |
| EnsembleData | Measure actual units for Reddit plus any no-Bright fallback use |

Do not reuse the historical official-X estimate as the current acquisition
budget. The operative total depends on configured vendors, demanded windows,
snapshot continuations and the number of active channels; read it from vendor
billing and ingestion audits.

Infrastructure is separate and small: Neon Postgres and Vercel for a workload
this size land in the tens of dollars a month, plus whatever the org already
spends on the inference endpoint it points Data Dumpster at. Bring-your-own-model
means AI cost is the org's existing contract, not a markup.

**For comparison**, Rival IQ's published plans have historically run from
roughly $240 to roughly $560 a month per seat-tier, though I have not verified
2026 pricing and they quote enterprise separately. **Low confidence on the
current number.** Do not claim a cost advantage until Bright Data and
EnsembleData spend has been measured under the live demand set. The reasons to
build are control of the AI, the honesty of the numbers, and newsroom-specific
analysis.

---

## 7. Engineering consequences already baked in

Things in the code that exist because of the above, listed so nobody
"simplifies" them later:

- **`publicSourceCredentials()` is an explicit deployment allowlist.** It routes
  pooled work independently of workspace owner credentials: Bright Data for
  existing Facebook and configured Instagram, TikTok, X, Threads and LinkedIn;
  EnsembleData for Reddit, X onboarding and the no-Bright fallbacks; official
  public interfaces for YouTube and Bluesky.
- **Every adapter carries `accessNotes`** and Settings renders it. If a platform
  cannot answer a question, the person configuring it finds out then, not from a
  confusing chart three weeks later.
- **The pooled runner injects `cursor.__isOwned = false`** and strips
  double-underscore keys before persisting the cursor. Facebook therefore uses
  Bright Data with the current deployment allowlist. The Meta adapter contains
  an owned/PPCA Graph path for direct or future isolated use, but the pooled
  runner supplies neither owner nor PPCA credentials.
- **`views` of 0 means "not exposed", never "no views"**, on YouTube, Bluesky,
  Facebook, and competitor X and Instagram. `engagementRateByView` is stored as
  NULL rather than 0 when views are 0, so the metrics layer can tell the
  difference.
- **Paid Bright Data receipts are source- and stage-bound.** A live receipt is
  resumed, and a failed paid stage never falls through to EnsembleData.
- **The refresh overlap window in `runner.ts` is the main cost dial.** It is
  currently a two-day constant. It should become a per-platform cost control.

## 8. Environment variables

`.env.example` documents both deployment public sources and retained owner/admin
configuration. `BRIGHTDATA_API_KEY` activates the purchased primary paths.
`ENSEMBLEDATA_TOKEN` activates Reddit, the X onboarding helper and the no-Bright
fallbacks. `META_IG_USER_ID`, TikTok owner tokens, LinkedIn admin tokens and Meta
owner/PPCA tokens are not pooled-source switches; the public allowlist excludes
them.

The Meta adapter still exposes two PPCA fields for direct and legacy callers:

- `ppcaApproved` — set to `true` only once Meta App Review has actually granted
  the feature.
- `ppcaAccessToken` — the token used to read Pages we do not administer. Meta
  recommends a system user access token here specifically to avoid rate limiting.
  Falls back to the main Page token if blank.

Neither field is consumed by normal pooled collection. Do not set an
organization credential or add an ad hoc environment fallback to activate
PPCA: the public observations are deployment-wide, while owner tokens can expose
private fields that must never enter pooled rows. After approval, release a
deployment-wide public credential binding only after the provenance,
source-scoped cursor, field-allowlist and owned-data-isolation gates in
`docs/META-PPCA-APPLICATION.md` and `docs/OWNED-DATA-ISOLATION.md` pass.

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
