# Data vendors: can one company sell us all of it?

**Audience:** CTO and whoever signs the data contracts.
**Status:** researched July 2026. Companion to `DATA-ACCESS.md`, which covers what
the first-party platform APIs give us. This document covers what third parties
will sell us on top of that.
**Not legal advice.** Section 7 discusses case law. I am not a lawyer. Run the
scraping question past BGM counsel before signing anything.

---

## 0. The answer, up front

**Yes, a single vendor will sell you one API that covers YouTube, Meta, X, TikTok,
LinkedIn, Instagram, Facebook, Reddit, Threads, Bluesky and Pinterest, with
competitor and public-account data, for under $100 a month at our scale. It is a
scraping vendor. There is no sanctioned equivalent that covers all of it in one
contract.**

**But there is no longer a single sanctioned gap on Facebook, and that changes
the recommendation.** An earlier version of this document, and of
`DATA-ACCESS.md`, treated Facebook competitor data as unobtainable through
sanctioned channels. That was wrong. Meta's **Page Public Content Access**
feature grants a live app the ability to read public posts, comments and
engagement for Pages it does not administer, and Meta's own Pages documentation
names the allowed usage as "aggregated, anonymized public content for competitive
analysis and benchmarking". It is App Review plus business verification, it takes
weeks, and it can be refused. But it is free, it is first-party, and it is the
route a newsroom should try first. See `docs/META-PPCA-APPLICATION.md`.

TikTok and LinkedIn are unchanged. TikTok's Research API bars commercial use and
LinkedIn has no competitor read path at any price. Those two gaps are still
scrape-or-nothing.

The market splits four ways:

| | Officially sanctioned | Covers competitors |
|---|---|---|
| Publishing APIs (Ayrshare, Phyllo Connect, Unipile, Mixpost) | Yes | **No** |
| **Meta App Review features (Page Public Content Access)** | **Yes** | **Yes, for Facebook Pages only, after review** |
| Scraping / data-as-a-service (ScrapeCreators, Bright Data, Apify, EnsembleData, Data365, Oxylabs) | **No** | Yes |
| Listening suites (Brandwatch, Meltwater, Sprinklr, Talkwalker) | Partly, via licensed firehoses | Yes, but not as a per-post competitive dataset, and they cost $25k to $130k a year |
| Official research programs (Meta Content Library, TikTok Research API) | Yes | Yes, but for-profit newsrooms are ineligible |

Every vendor in the publishing category is disqualified by the single requirement
that drives this project. That is not a knock on them. They are correctly built
for a different problem.

---

## 1. The one-line test

Ask any vendor exactly this:

> Can I retrieve the last 30 days of posts and engagement counts for
> facebook.com/nytimes and linkedin.com/company/the-new-york-times without the
> New York Times authorizing my application?

If the answer requires an OAuth token from the target account, the vendor is a
publishing tool and cannot do competitive intelligence. Everything else in a
sales deck is noise. Vendors will answer "yes, we support competitor analytics"
because their platform has a competitor tab that is fed by whatever the platform
APIs allow, which for Facebook and LinkedIn is nothing.

---

## 2. Category 1: unified publishing APIs. All disqualified.

These are OAuth aggregators. They normalize the write path (post to 13 networks
with one call) and the owned-account read path (analytics for accounts you
control). They are excellent at that. None of them can read an account you do not
control, because the underlying platform APIs will not let them.

| Vendor | Platforms | Owned | Competitor | Published price | Verdict |
|---|---|---|---|---|---|
| **Ayrshare** | 13+ incl. TikTok, IG, LI, YT, FB, X, Threads, Bluesky, Pinterest | Full: publish, analytics, comments, DMs | **No.** Analytics are scoped to connected profiles | Premium $149/mo (1 profile), Launch $299/mo (10), Business $599/mo (30) then $8.99/profile to 100, $3.49 to 500, $2.49 above. Min commitment 10 or 30 profiles by tier. Verified on ayrshare.com/pricing | **Disqualified.** Would be a strong pick if Pressbox ever needs to publish |
| **Phyllo** | ~20 incl. IG, YT, TikTok, X, Twitch, Snapchat, FB, LinkedIn | Full, via Identity/Connect OAuth | **Partial and creator-shaped.** Phyllo also sells Creator Analytics, Social Listening and Comment Analysis APIs that work by handle without OAuth. Their public-profile tier is real, but it is priced and modeled for influencer discovery, not for a fixed competitive set | Custom quote only. No public rate card. Secondary sources report entry around $199/mo. **I could not verify any dollar figure** | **Conditional.** Worth one sales call for their non-OAuth tier. Do not assume the pricing |
| **Unipile** | LinkedIn, email, WhatsApp, Slack, Telegram, Instagram DM | Messaging and inbox for connected accounts | **No.** It is a unified inbox, not an analytics source | Approx. EUR 49 / USD 55 per month minimum, roughly EUR 5 per linked account per month, unlimited calls. Medium confidence, from unipile.com/pricing-api via secondary summary | **Disqualified.** Wrong product category entirely |
| **Mixpost** | FB, IG, X, LinkedIn, Pinterest, others via official APIs | Publish and owned analytics, self-hosted | **No.** Uses the same official APIs we already call | One-time license, self-hosted, MIT-adjacent | **Disqualified.** It is a self-hosted Buffer. It would consume our platform keys, not supply data |

**Why this category exists and why it keeps getting recommended to us:** every
"one API for all social media" search result is one of these, because publishing
is the profitable, legally clean version of the problem. Owned-account
aggregation is a genuine engineering saving. It is not our problem.

---

## 3. Category 2: scraping and data-as-a-service. This is where the answer is.

All of these are unofficial. None has a platform partnership. All of them read
logged-out public pages and undocumented internal endpoints, and normalize the
result to JSON. They break when platforms change markup, and they fix it, and
that maintenance is what you are actually paying for.

### 3.1 The shortlist

| Vendor | Platforms with competitor read | Pricing (verified July 2026) | Model | Rate limits | Min commit |
|---|---|---|---|---|---|
| **ScrapeCreators** | TikTok (21 endpoints), Instagram (15), YouTube (16), Facebook (10), X (6), LinkedIn (6), Reddit, Threads, Bluesky, Pinterest, Truth Social, Snapchat, Twitch, plus FB/TikTok/Google/LinkedIn Ad Libraries. 36 APIs total | Free 100 credits. Freelance **$47 for 25,000 credits ($1.88/1k)**. Business **$497 for 500,000 credits ($0.99/1k)**. Enterprise custom. Credits never expire. Cached results cost 0 credits | Pay-as-you-go credits, synchronous REST, one `x-api-key` header | **States no rate limits, unlimited concurrency.** Self-reported 98.2% success, 3.12s avg response | **None.** No subscription |
| **Bright Data Web Scraper API** | IG profiles/posts/reels/comments, FB pages posts/reels/comments/events, TikTok profiles/posts/comments, YouTube channels/videos/comments, X posts/profiles, LinkedIn posts/company/people, Reddit, Pinterest, Bluesky, Quora, Vimeo | Free tier 5,000 records/mo. **Pay-as-you-go $1.50 per 1,000 records.** Scale **$499/mo including 384,000 records**, then $1.30/1k. Enterprise custom. Verified on brightdata.com/pricing/web-scraper | Async: trigger a collection job, poll for a snapshot, download JSON/CSV/Parquet or push to webhook/S3/Snowflake | Unlimited concurrency on all paid tiers | None on PAYG |
| **Bright Data Datasets** | Same 32 social datasets, pre-collected, 6.5B+ records | **$250 per 100,000 records ($0.0025/record), $250 minimum order.** Refresh subscriptions discount up to 80% for monthly refresh. Verified | Bulk file delivery, not a live API | n/a | $250 per order |
| **Apify** | Store actors for IG, TikTok, YouTube, FB, X, LinkedIn, Reddit, Threads. Also hosts official ScrapeCreators actors | Platform: Free ($5 credit), Starter $29/mo, Scale $199/mo, Business $999/mo. Actors bill per result **on top**. Third-party price surveys report IG Scraper approx. $1.50/1k posts, TikTok (clockworks) approx. $1.70/1k, YouTube approx. $2.40/1k. **Actor prices are unverified against Apify's own pages, check before budgeting** | Actor runs, sync or async, per-result billing plus compute units | Per-actor, generally generous | None |
| **EnsembleData** | TikTok, Instagram, YouTube, Threads, Reddit, Twitch, Twitter, Snapchat. **No Facebook, no LinkedIn** | Free 50 units/day. Wood **$100/mo, 1,500 units/day**. Bronze **$200/mo, 5,000/day**. Silver **$400/mo, 11,000/day**. Gold **$800/mo, 25,000/day**. Platinum **$1,400/mo, 50,000/day**. Verified on ensembledata.com/pricing | Daily unit budget, resets 00:00 UTC, **unused units do not roll over**. IG user detailed info costs 10 units, TikTok user posts 1 unit per 10 posts | Implicit via daily units | Monthly subscription |
| **Data365** | Facebook, Instagram, X, TikTok, Reddit, Pinterest, Threads (up to 7 networks) | Basic **EUR 300/mo, 1 network, 500,000 credits**. Standard **EUR 850/mo, 3 networks, 1,000,000 credits**. Custom up to 7 networks. 1 post = 1 credit, post + comments = 5, search = 7, profile with info = 9. Verified on data365.co/pricing | Monthly subscription with credit pool, async job model | Claims 1,000+ profiles per hour | Monthly, and the per-network gating is punitive for us |
| **SocialData** | X / Twitter only | **$0.0002 per tweet or profile returned ($0.20 per 1,000)**, no subscription, 3 free requests/min. Medium confidence, from docs.socialdata.tools via search summary, not fetched directly | Pay-as-you-go, per-item | 3 req/min free tier | None |
| **Oxylabs** | Social via generic Web Scraper API and templates, weaker purpose-built social coverage than the others | From $49/mo (Micro). Per-result roughly $0.40 to $0.50 per 1,000 on higher tiers. **Low confidence, these figures come from third-party reviews and Oxylabs' Google-specific pricing page** | Subscription plus per-result | Plan-dependent | Monthly |
| **RapidAPI marketplace** | Dozens of one-off social scrapers | $0 to $50/mo per API, wildly variable | Marketplace | Per-listing | Per-listing | 

**Lamatic:** I could not find a social data vendor by that name. The closest
matches are **LamaTok** (a TikTok-only scraping API) and **Lamatic.ai** (an
unrelated agent-orchestration platform). If someone recommended "Lamatic," ask
them which they meant. Neither is a multi-platform aggregator.

### 3.2 What they cover, and what we no longer need them for

`DATA-ACCESS.md` used to list Facebook, TikTok and LinkedIn competitors as three
structural blind spots unobtainable through sanctioned channels. That was wrong
about Facebook: **Page Public Content Access covers it, sanctioned and free,
subject to App Review.** It remains right about TikTok and LinkedIn.

So the vendors below fill two genuine gaps, not three. The Facebook endpoints are
still listed because they matter as a fallback if PPCA review is refused, and
because a vendor is the only way to get Facebook data faster than App Review can
deliver it.

ScrapeCreators, verified from their own endpoint documentation:

| Blind spot | Endpoint | What it returns | Caveat |
|---|---|---|---|
| **Facebook competitors (fallback only)** | `GET /v1/facebook/profile/posts` | Public page posts as an incognito browser would see them, with engagement | **3 posts per call.** A 30-day backfill for one busy page is roughly 100+ paginated calls. Budget accordingly. Prefer PPCA, which returns 100 per page and is sanctioned |
| **Facebook competitors (fallback only)** | `GET /v1/facebook/profile/reels`, `/post`, `/post/comments` | Reels with view counts, post detail, comments | Reel view_count can be null or lower than the public badge. They document the workaround. Reel view counts are the one thing here PPCA does not give us |
| **LinkedIn competitors** | `GET /v1/linkedin/company/posts` | Company page posts, public view | **Hard cap of 7 pages.** LinkedIn-side limit. No deep history |
| **LinkedIn competitors** | `GET /v1/linkedin/company` | Company page metadata incl. follower count | Public fields only |
| **TikTok competitors** | `GET /v1/tiktok/profile`, `/v3/tiktok/profile/videos`, `/v2/tiktok/video` | Profile, video list, full video stats, transcripts, audience demographics | The richest of the three |
| **Instagram competitors beyond business_discovery** | 15 endpoints incl. reels with view counts | More than the Graph API discovery edge gives us | Saves and reach still unavailable. Nobody has them |

Bright Data covers the same three gaps through Facebook Pages Posts by Profile
URL, LinkedIn posts by company URL, and the TikTok profile and posts scrapers.

**This is the single most consequential finding in this document.** The claim in
`DATA-ACCESS.md` that Facebook, TikTok and LinkedIn competitor data is
"not purchasable" should be amended to "not purchasable through sanctioned
channels, and readily purchasable from unsanctioned ones." Whether we buy it is
a legal and editorial decision, not a technical one. Section 7.

---

## 4. Category 3: listening and analytics suites with API access

These are products, not data feeds. You are buying seats and a UI, and the API is
an export hatch bolted on, usually gated behind the top tier. They do have
competitor data, and much of it is licensed rather than scraped, which is the
argument for them. The pricing is the argument against.

| Vendor | Competitor data | API | Price | Notes |
|---|---|---|---|---|
| **Brandwatch** (Cision) | Yes, mentions-oriented. Licensed X firehose historically, plus Reddit, forums, news | Yes, additional fee, enterprise tier | No public rate card. Vendr third-party procurement data: **median annual contract approx. $50,000**, observed range approx. $19.5k to $81.2k | Best-in-class for listening. Wrong shape for per-post competitive benchmarking |
| **Talkwalker** (Hootsuite) | Yes, similar posture | Yes, enterprise | No public rate card. Vendr median approx. **$27,000/year** | Same |
| **Meltwater** | Yes, plus PR and news | Yes, add-on cost | No public rate card. Reported tiers: Starter $6k to $15k/yr, Pro $15k to $40k/yr, Enterprise $40k to $150k+/yr | Already common in newsrooms. Check whether BGM has an existing contract before buying anything |
| **Sprinklr** | Yes | Yes, overage charges beyond standard limits | Enterprise from approx. **$50,000**, reported median approx. $129,000. **Self-serve plans sunset 30 April 2026** | Out of scope at our scale |
| **Emplifi** | Yes, explicit competitive benchmarking over billions of posts | Enterprise | Reported from approx. $200/mo entry, enterprise custom | Closest commercial analogue to Rival IQ after Rival IQ itself |
| **Dash Social** (formerly Dash Hudson) | Yes, on the Advance tier | Limited | Reported from approx. $249/mo | Visual-first, IG/TikTok/Pinterest weighted |
| **Socialinsider** | Yes, FB, IG, X, LinkedIn, YouTube, TikTok, explicitly a competitive benchmarking tool | **Yes, but only on Advanced tier and above** | From $99/mo (Social Media Manager, 20 profiles). Professional approx. $166/mo, Advanced approx. $333/mo annual. API on Advanced+ | **The most interesting vendor in this category for us.** Cheap, competitor-native, has an API. Worth a trial specifically to see what their LinkedIn and TikTok competitor fields actually contain |
| **Sprout Social** | Competitor reports in-product, **no historical backfill**, X unavailable due to network API limits | Public API on Advanced plan, and it serves **your own profile data only** | Reported SMB average approx. $18.4k/yr | Disqualified on the API. The API is an owned-data export |
| **Later / Dash** | Owned-account weighted | Minimal | n/a | Disqualified |
| **Rival IQ** (Quid) | The product we are replacing | No customer-facing bulk data API | Published **$239 to $519/month**, 15% off annual, approx. $50/mo per 5 additional companies, per-seat add-ons | Acquired by NetBase Quid in **December 2021**, not 2025. Quid is the parent; Rival IQ still sells standalone subscriptions |

**Verdict on the category:** if BGM already pays Meltwater or Brandwatch for the
PR desk, get Pressbox added to that contract's API entitlement before buying
anything new. Otherwise none of these clear the bar. A $27k-to-$50k annual
contract to feed an internal tool that we are building specifically to avoid a
$519/month Rival IQ bill is not a coherent purchase.

---

## 5. Category 4: official research programs. All closed to us.

Covered in `DATA-ACCESS.md` section 2, updated here with 2026 detail.

| Program | Covers | Eligible? | Cost |
|---|---|---|---|
| **Meta Content Library / API** | Public FB Pages and IG Business content, the CrowdTangle successor | **No.** Restricted to academic institutions, qualifying non-profits, and in the EU-facing CASD pathway, credentialed news organizations with a specific research question and a data management plan. A commercial newsroom building an operational product does not qualify, and even a granted researcher cannot use it as a production backing store | CASD access free for qualified researchers. The SOMAR virtual data enclave is reported at **$371 per team per month plus a one-time $1,000 setup**, as of January 2026. Single-source, medium confidence |
| **TikTok Research API** | Public TikTok video and profile data | **No.** Universities and non-profit academic institutions in US, EEA, UK, Switzerland, Brazil only. TikTok has tightened this, not loosened it. Commercial platforms previously using it for content discovery have been told to migrate to commercial endpoints or a licensed third party. Using research credentials commercially risks losing access | Free if eligible |
| **TikTok Commercial Content API** | Ads and commercial content in the Commercial Content Library | **No.** Approved researchers and qualified organizations, no access for commercial entities, agencies or marketers | Free if eligible |
| **X API pay-per-use** | Full public conversation, competitor timelines, full-archive search back to 2006 | **Yes. This is the one sanctioned competitor-data API we can actually buy** | See 5.1 |

Note the asymmetry that defines this whole market: the two platforms that killed
newsroom access (Meta, TikTok) route their public-interest data through academic
gatekeepers, while the platform that monetized it (X) will sell it to anyone with
a credit card.

### 5.1 X API pricing, now verified against X's own documentation

`DATA-ACCESS.md` flagged the X numbers as medium confidence from secondary
sources. They are now confirmed from docs.x.com/x-api/getting-started/pricing:

| Resource | Cost |
|---|---|
| Posts: Read | **$0.005 per resource** |
| User: Read | $0.010 per resource |
| Following/Followers: Read | $0.010 per resource |
| Like: Read | $0.001 per resource |
| **Owned Reads** (your own posts, mentions, followers, via your own app's authenticated user) | **$0.001 per resource** |
| Post: Create | $0.015 per request |
| Pay-per-use monthly cap | **2,000,000 Post reads per billing cycle**, above which you need Enterprise |

Two details that materially change our cost model and were not in
`DATA-ACCESS.md`:

1. **Deduplication.** Resources are deduplicated within a 24-hour UTC window. Requesting the same Post twice in one day is charged once. Described as a soft guarantee, so do not architect around it, but it means intra-day refreshes are close to free and the binding cost is the number of distinct post-days we touch.
2. **Owned Reads at $0.001.** Reading Globe Media's own X timelines is one fifth the price of reading a competitor's. Worth a flag in the adapter so we do not pay competitor rates for owned channels.

Also: X now offers up to 20% back in xAI API credits on cumulative X API spend
above $1,000 per cycle. Irrelevant at our volume, and we are bring-your-own-model
anyway, but it is a real discount lever if spend ever grows.

Spending limits and auto-recharge are configurable in the developer console. Set
a hard spending limit before the first production run.

---

## 6. Category 5: news and media specific

| Vendor | What it is | Competitor social data? | Price |
|---|---|---|---|
| **NewsWhip** | Predictive story and content tracking, engagement on articles across social | **Yes, but article-centric, not account-centric.** It tells you which stories are travelling, not what a competitor's Instagram account did this week. Genuinely useful for a newsroom and complementary to Pressbox rather than substitutable | **No public pricing.** Custom quote. API availability is inconsistently documented across their own site and third-party listings. Ask directly |
| **Chartbeat** | Real-time first-party newsroom analytics | No. Your sites only | Reported from approx. $7,000/year. Medium confidence |
| **Parse.ly** (WP VIP) | First-party content analytics with deeper history | No. Your sites only | Reported from approx. $2,000/month at 5M monthly uniques. Medium confidence |
| **Similarweb** | Web traffic and referral estimates, including social referral share by competitor domain | **Domain-level, not account-level.** Answers "how much of nytimes.com traffic comes from Facebook," not "how did their Facebook page perform" | Self-serve web platform from $125/mo annual. **API is a custom-quoted add-on consumed via Data Credits, with no self-serve tier.** No published API price |
| **Comscore** | Panel-based audience measurement | No account-level social | Enterprise, no public pricing |

**Verdict:** none of these substitute for a social data vendor. NewsWhip is the
one worth a conversation, and it is a different product solving an adjacent
newsroom problem. Chartbeat and Parse.ly answer "how did our journalism do,"
which is a first-party question Pressbox is not trying to answer.

---

## 7. The legal question

**I am not a lawyer. This is not legal advice. It is a briefing to help you frame
the question for someone who is.** Get BGM counsel to sign off before any scraped
data enters a production system with the Globe's name on it.

### 7.1 What the case law actually establishes

**hiQ Labs v. LinkedIn** is the case everyone cites and it is narrower than the
citation implies.

- The Ninth Circuit held, in 2019 and again on remand in **April 2022** after Van Buren, that scraping data from **publicly accessible** pages does not access a computer "without authorization" under the **Computer Fraud and Abuse Act**. It tracks the Supreme Court's narrow reading of the CFAA in **Van Buren v. United States** (2021).
- **What it did not hold:** that scraping is lawful generally. It resolved one federal criminal-adjacent statute. It left breach of contract, copyright, trespass to chattels, unjust enrichment, and state law untouched.
- **How it ended:** hiQ ultimately lost on the contract claim and settled. hiQ agreed to **stop all scraping of LinkedIn**, delete the scraped data, and a **$500,000 judgment** was entered against it. The company that "won" the famous scraping case no longer exists as a scraper. Anyone citing hiQ as a green light is citing the headline and not the docket.

**The two rulings that matter more for a vendor decision**, because they are about
the vendors we would actually buy from:

- **Meta Platforms v. Bright Data** (N.D. Cal., Judge Edward Chen, summary judgment 23 January 2024). The court held that Meta's terms govern "your use" of the products, and that **logged-off scraping of public data is not "use"**, so the terms do not bar it, and "perforce" do not prohibit the sale of such public data. Meta dropped the suit roughly a month later. This is the strongest authority in the scrapers' favor, and it is about exactly the Facebook and Instagram public-page data we would be buying.
- **X Corp. v. Bright Data** (N.D. Cal., Judge William Alsup, May 2024). Contract claims dismissed. State-law claims over selling publicly posted content held **preempted by the Copyright Act**. Alsup wrote that giving platforms too much control over public data risks "information monopolies." **However**, in December 2024 Alsup allowed X to amend and proceed on new harm allegations. **This case is not finally resolved.** Do not treat it as settled.

**The direction of travel in 2025 and 2026 is less favorable.** In October 2025
Reddit sued Perplexity along with scraping vendors **SerpApi, Oxylabs and
AWMProxy**, pleading **DMCA section 1201 circumvention** rather than CFAA. That
is a deliberate shift to a theory hiQ does not answer. One of the named
defendants, Oxylabs, is on our candidate list. Litigation risk in this market is
now vendor-specific, not just theory-specific.

### 7.2 The realistic risk posture for Boston Globe Media specifically

Honest read, and I will flag where I am uncertain.

**Legal exposure to us is low and indirect.**

- We would be a **customer of a data vendor**, not the scraper. In the Meta and X cases the platforms sued the vendor, not the vendor's customers. I am not aware of a platform suing a downstream buyer of scraped public social data. That is an absence of evidence, not a guarantee.
- The data is public, engagement-count-shaped, and used internally for measurement. It is not being republished, resold, or used to train a model. That is close to the least aggravated fact pattern available.
- Every serious vendor indemnifies to some degree and asserts GDPR/ToS compliance. **Read the actual indemnity clause.** ScrapeCreators is a small company and its terms should be assumed thin until read. Bright Data carries SOC 2, ISO 27001, a published trust center, and a track record of winning these cases, which is a large part of what its premium buys.

**Reputational exposure is the real risk, and it is asymmetric for a newsroom.**

- The Globe's newsroom has covered platform data practices, scraping, and privacy. A competitive-intelligence tool inside the same building that scrapes Meta and LinkedIn is a story a rival outlet would enjoy writing. The defense ("public data, engagement counts, internal measurement only") is correct and boring, which is exactly the kind of defense that does not survive a headline.
- Mitigation is cheap and should be non-negotiable if we proceed: collect only public engagement counts and post metadata for **organizational accounts**, never individuals; never store commenter identities; document the vendor and the scope in a one-page data statement; ensure the vendor's ToS and our contract are on file; put it through BGM legal and, ideally, tell the newsroom leadership before someone else does.

**Operational risk is underrated and probably the one that bites first.**
Scraped endpoints break. TikTok and Instagram change internals without notice.
A vendor's success rate is a marketing number until you have run it for a
quarter. Any adapter built on a scraping vendor must degrade to a labelled gap,
not to a zero. Pressbox is already built this way, which is fortunate.

### 7.3 A defensible position, if we want one

There is a coherent line to draw, and I recommend drawing it explicitly:

1. **Sanctioned first.** Bluesky, YouTube, RSS, owned Meta/TikTok/LinkedIn tokens, Instagram business_discovery, and the paid X API cover everything they can cover. All free or metered, all first-party.
2. **One vendor, narrowly scoped, for the three structural gaps.** Facebook, LinkedIn and TikTok competitor **posts and public engagement counts for organizational accounts only**. Nothing about people. No comments text at first. No archives.
3. **Label it in the product.** The adapter's `accessNotes` says the data is vendor-sourced and unofficial. Section 7 of `DATA-ACCESS.md` already establishes the honesty-about-provenance pattern. Extend it: a chart fed by a scraping vendor should say so.
4. **Kill switch.** If the vendor is sued, or the newsroom objects, the adapter is one file and one registry line. Removing it degrades three platforms to labelled gaps and breaks nothing else.

If BGM legal is not comfortable with step 2, the fallback is the sanctioned-only
stack in section 9.2, which still ships a real product and costs about $150 a
month. That is a genuinely acceptable outcome, not a consolation prize.

---

## 8. What Rival IQ almost certainly uses

**This section is inference. I have no inside knowledge of Rival IQ's
architecture, contracts, or vendors. It is reasoned from what their product shows
and does not show. Extends section 5 of `DATA-ACCESS.md`, which reached the same
conclusions for Instagram and Facebook.**

| Platform | Inferred source | Confidence | Reasoning |
|---|---|---|---|
| Owned channels, all platforms | Customer OAuth | High | Saves, reach, impressions and click data have no other origin |
| Instagram competitors | Graph API `business_discovery` | High | Their competitor field set is followers, posts, likes, comments. That is exactly the discovery edge, and exactly what it omits is what they omit |
| Facebook competitors | Pre-August-2024 CrowdTangle archive plus public page metadata, possibly supplemented | Medium | They were a CrowdTangle-era product. The shape of what they still show is consistent with having lost live access |
| X competitors | Enterprise contract or reseller | Medium | At retail $0.005/post across their whole customer base the metered bill would be enormous. Enterprise starts around $42k/month, which is a line item for a company their size |
| **TikTok competitors** | **A commercial scraping vendor** | **Medium, revised upward from "unclear"** | This is the interesting one. The Research API bars for-profit use and TikTok tightened it further in 2026. The Display API is owned-only. Rival IQ shows TikTok competitor post-level metrics. Having now surveyed the market, there is exactly one way to obtain that data, and it is the category in section 3. Either they buy it or they scrape it themselves |
| **LinkedIn competitors** | **Same** | **Medium** | Identical logic. LinkedIn's Community Management API is owned-only at any price. Anyone showing LinkedIn competitor post data is reading public pages |

**The uncomfortable implication:** if we decline to use a scraping vendor on
principle, we are holding ourselves to a standard the incumbent we are replacing
probably does not meet. That is a legitimate choice for a newsroom to make. It
should be made deliberately, with the tradeoff named, rather than by default.

**What we still cannot replicate:** roughly thirteen years of stored competitor
time series, including CrowdTangle-era Facebook data that no longer exists
anywhere. That moat is real and unassailable. The response is to start our own
clock now, which is free, and to be better on everything that is not history.

---

## 9. Recommended stack for Pressbox

Scale assumption throughout: **10 companies tracked across 6 platforms**, daily
ingestion, three-day engagement refresh window, newsroom accounts posting roughly
20 to 25 times a day on the busy platforms.

### 9.1 Recommended: sanctioned core plus one narrow vendor

| Layer | Source | Platforms | Monthly | Confidence |
|---|---|---|---|---|
| Free and sanctioned | Bluesky AT Protocol public appview | Bluesky, owned and competitor, identical | **$0** | High |
| Free and sanctioned | YouTube Data API v3 | YouTube, owned and competitor | **$0** | High |
| Free and sanctioned | RSS | Publishing cadence for every competitor | **$0** | High |
| Free and sanctioned | Meta Graph API, owned Pages/IG plus IG business_discovery | Facebook owned, Instagram owned and thin competitor | **$0** | High |
| Free and sanctioned | LinkedIn Community Management API, owned orgs | LinkedIn owned only | **$0** | High |
| Free and sanctioned | TikTok Display API, owned | TikTok owned only | **$0** | High |
| **Paid, sanctioned** | **X API pay-per-use** | X owned and competitor | **$110 to $150** | High on the rate, medium on our volume |
| **Paid, unsanctioned** | **ScrapeCreators, Freelance tier** | **Facebook, LinkedIn and TikTok competitors, plus Instagram enrichment** | **$25 to $47** | High on the rate, medium on our volume |
| Optional second source | Bright Data Web Scraper API, free tier | Weekly cross-validation of vendor numbers | **$0** (5,000 records/mo free) | High |
| **Total** | | | **approx. $175, budget $200** | Medium |

**Why ScrapeCreators over the alternatives, at our scale:**

- It is the only vendor on the list that covers **all three** of our structural gaps, Facebook and LinkedIn and TikTok, plus Instagram, X, YouTube, Reddit, Threads, Bluesky and Pinterest, from one key.
- No subscription, no minimum, credits never expire. If we stop, we stop. That matters for an internal tool whose future is not guaranteed.
- Synchronous REST with a single header. It maps onto our adapter contract in an afternoon. Bright Data's trigger-and-poll snapshot model would require a job-state machine our runner does not currently have.
- Cached results are free, which lines up neatly with our idempotent, overlapping-window refresh pattern.
- **Its weaknesses:** it is a small company, the PAYG tier has no SLA, and the terms should be assumed thin until read. It is a $47 bet, not a dependency.

**Why not the cheaper-looking options.** EnsembleData at $100/month is the best
engineered of the specialists but has **no Facebook and no LinkedIn**, which is
two thirds of our gap. Data365 at EUR 300/month for one network and EUR 850 for
three is priced for a different customer. Apify is fine but you pay a platform
subscription plus per-result fees to a third-party actor author, which is two
counterparties instead of one.

### 9.2 Fallback: sanctioned-only, if legal says no

| Layer | Monthly |
|---|---|
| Everything free and sanctioned above | $0 |
| X API pay-per-use | $110 to $150 |
| **Total** | **approx. $150** |

Blind spots remain exactly as documented in `DATA-ACCESS.md` section 6: no
Facebook competitors, no TikTok competitors, no LinkedIn competitors, no
impressions for anyone else's content anywhere, no Instagram competitor saves or
reach or Stories. Ship it labelled. It is still a real product.

### 9.3 Blind spots that survive even the recommended stack

Buying a vendor does not buy omniscience. These remain unavailable **from anyone,
at any price**, and the product must keep saying so:

| Gap | Why |
|---|---|
| **Impressions and reach for any account we do not own, on every platform** | Platforms do not render it publicly, so there is nothing to scrape. Structural and permanent. `engagementRateByView` stays undefined for competitors |
| **Instagram competitor saves** | Not rendered publicly |
| **Instagram and Facebook Stories for competitors** | Ephemeral, not reliably collectable |
| **LinkedIn deep history for competitors** | The public company-posts view caps at 7 pages. No backfill beyond that, from any vendor |
| **Facebook competitor history before we start** | Nobody sells the CrowdTangle archive. Rival IQ's copy of it is their moat |
| **YouTube shares** | Removed from the Data API years ago, owner-only |
| **Demographics for competitor audiences** | Owner-only everywhere. Vendors that claim it are modelling, not measuring, and we should not put modelled demographics next to measured engagement |

### 9.4 Cost sensitivity, so nobody is surprised

The two dials that actually move the bill:

| Change | Effect |
|---|---|
| Refresh window 3 days to 7 days | X roughly doubles to approx. $260. ScrapeCreators roughly doubles to approx. $45 |
| 10 companies to 25 companies | Both scale close to linearly. Approx. $440 total |
| Facebook backfill depth | The `/facebook/profile/posts` endpoint returns **3 posts per call**. A 90-day initial backfill of 10 busy pages is roughly 7,500 credits, about $14 one-time. Ongoing it is the single largest credit consumer. Cap it |
| X intra-day refreshes | Close to free thanks to 24-hour UTC deduplication. Cross-day refreshes are not |
| Reading our own X channels | Route through Owned Reads at $0.001 rather than $0.005. Five times cheaper for the same data |

---

## 10. Migration: which adapters to build, in what order

### 10.1 One correction to the framing

The brief assumed "adding an aggregator is one new adapter file." Looking at
`src/lib/adapters/types.ts`, that is not quite right, and the difference matters
for scheduling the work.

`ChannelAdapter` carries a single `platform: Platform` field and the registry
keys on it. A channel row is a platform plus a handle. So an aggregator covering
four platforms cannot be one adapter, because there is no platform value it could
claim, and we already have `meta.ts`, `linkedin.ts` and `tiktok.ts` occupying
those keys with their owned-account paths.

**The right shape is a shared vendor client plus a source branch inside each
existing adapter**, exactly parallel to the `cursor.__isOwned` branch the runner
already injects:

- `src/lib/adapters/vendors/scrapecreators.ts`, one HTTP client. Not a `ChannelAdapter`. Knows the base URL, the `x-api-key` header, retry and backoff, and maps vendor JSON to `NormalizedPost` and `NormalizedAudience`. Calls `ctx.onApiCall()` once per network request, which makes `ingestion_runs.api_calls` a **literal credit meter**.
- Each platform adapter gains a competitor path that uses the client when a vendor credential is present, and falls back to today's behaviour when it is not.

This keeps the contract intact, keeps `OWNED_ONLY_PLATFORMS` meaningful (a
platform leaves that set only when the vendor credential is configured), and
keeps the kill switch to one credential deletion rather than a code change.

### 10.2 Build order

| # | Work | Why this order | Effort | Unlocks |
|---|---|---|---|---|
| **1** | **X Owned Reads.** In `twitter.ts`, route owned channels through `GET /2/users/{id}/tweets` on our own app's authenticated user so they bill at $0.001 rather than $0.005 | Pure cost saving, no new dependency, no legal question, ships today | Hours | 80% cheaper owned X reads |
| **2** | **`vendors/scrapecreators.ts` client plus TikTok competitor path** | TikTok is the cleanest test case. There is no existing competitor path to regress, the vendor's TikTok coverage is its deepest (21 endpoints, including view counts and transcripts), and the data shape maps directly onto `NormalizedPost` with `views` actually populated. If the vendor is unreliable we find out here, cheaply | 1 to 2 days | TikTok leaves `OWNED_ONLY_PLATFORMS` |
| **3** | **LinkedIn competitor path** in `linkedin.ts` | Second cleanest. `GET /v1/linkedin/company` plus `/company/posts`. Low volume, low credit cost. **Set `accessNotes` to state the 7-page public cap explicitly** so nobody reads a truncated history as a decline in posting | 1 day | LinkedIn leaves `OWNED_ONLY_PLATFORMS`, with a documented history ceiling |
| **4** | **Facebook competitor path** in `meta.ts` | Highest value, highest cost, most pagination. Do it once the client is proven. Needs a hard page cap and a per-run credit budget, because 3 posts per call on a page posting 25 a day is where the money goes. Reels need the documented two-call workaround to get a trustworthy view count | 2 days | Facebook leaves `OWNED_ONLY_PLATFORMS`. This is the single biggest product gap closed |
| **5** | **Instagram enrichment**, not replacement | Keep `business_discovery` as the primary competitor source. It is sanctioned and free. Use the vendor only to add reel view counts, which discovery does not return. Never let the vendor silently replace a sanctioned source | 0.5 day | `views` populated for competitor reels |
| **6** | **Per-platform refresh windows** | `DATA-ACCESS.md` already flags the two-day constant in `runner.ts` as the main cost dial. Once four more paid platforms are live it stops being a nice-to-have. X and Facebook want short windows, LinkedIn and YouTube can go long | 1 day | Direct control of the bill |
| **7** | Optional: **`vendors/brightdata.ts`** behind the same internal interface | Second source for cross-validation and a migration path if ScrapeCreators fails or gets sued. Async trigger-and-poll, so it needs job state the runner does not have yet. Do not build this until there is a reason | 3+ days | Vendor independence |

### 10.3 Implementation notes tied to the actual contract

- **`rateLimit`.** ScrapeCreators advertises no rate limits and unlimited concurrency. Do not encode that as unlimited. The scheduler uses `rateLimit` to pace runs, and an unpaced adapter is a runaway credit bill. Set a self-imposed value, something like `{ callsPerWindow: 600, windowSeconds: 60 }`, and treat it as a spend governor rather than a platform constraint.
- **`credentialFields`.** One secret field, `apiKey`. Presence of that credential is what flips a platform from owned-only to competitor-capable. That is the kill switch.
- **`worksUnauthenticated`.** Stays `false` on these paths. Bluesky remains the only `true`.
- **`accessNotes`.** Must say the data is vendor-sourced and unofficial, and must name the specific limits: 3 posts per Facebook call, 7-page LinkedIn cap, no saves, no reach, no impressions. Settings already renders this. The UI should surface provenance on the chart too, not just in configuration.
- **`views` of 0.** The existing rule holds and gets more important. Vendor-supplied Facebook reel `view_count` can be null or understated. Store null, not 0, so `engagementRateByView` stays NULL rather than becoming a confidently wrong number.
- **`warnings`.** Populate on every partial fetch: truncated LinkedIn history, capped Facebook pagination, missing view counts. The runner already surfaces these.
- **`AdapterError`.** Vendor 429s and 5xx are `retryable: true`. A vendor endpoint that has been broken by a platform change returns structurally valid but empty results, which is worse. Add a sanity floor: zero posts from an account that had posts yesterday is a warning, not a data point.

### 10.4 What to ask any vendor before signing

1. The section 1 question, verbatim, for Facebook and LinkedIn specifically.
2. What is your published uptime and what happened the last time Instagram or TikTok changed their internals? Ask for the incident, not the SLA number.
3. What exactly do you indemnify, and against whom?
4. Are you currently a defendant in any scraping litigation? (As of October 2025 Oxylabs is. Ask everyone.)
5. Can we get a 30-day trial against our real landscape, not a demo dataset?
6. What is the deepest history you can backfill per platform, and what is the per-call page size? The Facebook 3-posts-per-call and LinkedIn 7-page limits are the kind of thing that never appears in a sales deck.

---

## 11. Bottom line

| Question | Answer |
|---|---|
| Is there one vendor for everything, including competitors? | Yes: **ScrapeCreators**, or **Bright Data** if we want an enterprise counterparty. Both are scraping-based. There is no sanctioned equivalent and there will not be one |
| Do the publishing aggregators help? | **No.** Ayrshare, Unipile and Mixpost are owned-account only, by design. Phyllo has a non-OAuth tier worth one call but is priced and shaped for influencer discovery |
| Do the listening suites help? | Not at this scale. $27k to $130k a year to feed an internal tool built to avoid a $519/month bill |
| Can we buy the official research data? | **No.** Meta Content Library and TikTok Research API both exclude for-profit organizations. A commercial newsroom does not qualify |
| What does the recommended stack cost? | **Approximately $175/month, budget $200.** X API $110 to $150, ScrapeCreators $25 to $47, everything else $0 |
| What if legal says no to scraping? | **$150/month**, sanctioned only, with Facebook, TikTok and LinkedIn competitors labelled as gaps. Still a shippable product |
| What do we build first? | X Owned Reads, then the vendor client with TikTok, then LinkedIn, then Facebook |

---

## Sources

Vendor pricing pages fetched directly, July 2026:
- [Ayrshare pricing](https://www.ayrshare.com/pricing/)
- [ScrapeCreators pricing and endpoint coverage](https://scrapecreators.com/), [LinkedIn API](https://scrapecreators.com/linkedin-api), [Facebook API](https://scrapecreators.com/facebook-api)
- [Bright Data Web Scraper API pricing](https://brightdata.com/pricing/web-scraper), [Social Media Datasets](https://brightdata.com/products/datasets/social-media)
- [EnsembleData pricing](https://ensembledata.com/pricing)
- [Data365 pricing](https://data365.co/pricing)
- [Phyllo Social Data API](https://www.getphyllo.com/social-data-api)
- [X API pay-per-usage pricing](https://docs.x.com/x-api/getting-started/pricing)

Secondary sources, treat dollar figures as indicative:
- [Apify pricing](https://use-apify.com/docs/what-is-apify/apify-pricing), [Apify social scrapers](https://use-apify.com/docs/best-apify-actors/best-social-media-scrapers)
- [Oxylabs Scraper API pricing](https://oxylabs.io/products/scraper-api/web/pricing)
- [SocialData pricing](https://docs.socialdata.tools/getting-started/pricing/)
- [Unipile API pricing](https://www.unipile.com/pricing-api/)
- [Socialinsider pricing](https://www.socialinsider.io/pricing)
- [Rival IQ pricing](https://www.rivaliq.com/pricing/)
- [Brandwatch, Vendr procurement data](https://www.vendr.com/marketplace/brandwatch), [Meltwater, Vendr](https://www.vendr.com/marketplace/meltwater), [Sprinklr, Vendr](https://www.vendr.com/marketplace/sprinklr), [Similarweb, Vendr](https://www.vendr.com/marketplace/similarweb)
- [Sprout Social public API scope](https://support.sproutsocial.com/hc/en-us/articles/360045006152-Sprout-Public-API), [Sprout network API limitations](https://support.sproutsocial.com/hc/en-us/articles/15529341993101-Network-API-limitations)
- [NewsWhip API](https://www.newswhip.com/newswhip-api/)

Official program eligibility:
- [Meta Content Library and API FAQ](https://developers.facebook.com/docs/content-library-and-api/support/faqs/)
- [Meta Content Library updates](https://transparency.meta.com/researchtools/meta-content-library/MCL-API-update-supporting-independent-research/)
- [TikTok Research API](https://developers.tiktok.com/products/research-api/), [TikTok Commercial Content API](https://developers.tiktok.com/products/commercial-content-api)

Case law and litigation:
- hiQ Labs v. LinkedIn, 9th Cir. April 2022 on remand: [Jenner & Block](https://www.jenner.com/en/news-insights/publications/client-alert-data-scraping-in-hiq-v-linkedin-the-ninth-circuit-reaffirms-narrow-interpretation-of-cfaa), [Fenwick](https://www.fenwick.com/insights/publications/hiq-labs-scrapes-by-again-the-ninth-circuit-reaffirms-that-data-scraping-does-not-violate-the-cfaa-1), [Farella Braun + Martel on the settlement and $500k judgment](https://www.fbm.com/publications/what-recent-rulings-in-hiq-v-linkedin-and-other-cases-say-about-the-legality-of-data-scraping/)
- Meta Platforms v. Bright Data, N.D. Cal., 23 January 2024: [Farella Braun + Martel](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/), [Quinn Emanuel client alert](https://www.quinnemanuel.com/the-firm/news-events/client-alert-meta-v-bright-data-significant-decision-for-web-scraping-industry/)
- X Corp. v. Bright Data, N.D. Cal., May 2024 and December 2024: [Courthouse News](https://www.courthousenews.com/judge-tosses-xs-contract-claims-against-data-scraping-company/), [MediaPost on the December revival](https://www.mediapost.com/publications/article/401510/x-corp-can-revive-scraping-battle-with-bright-dat.html)
- Reddit v. Perplexity, SerpApi, Oxylabs, AWMProxy, S.D.N.Y., 22 October 2025: [Search Engine Land](https://searchengineland.com/reddit-sues-perplexity-serpapi-scraping-google-463681)

Rival IQ ownership:
- [NetBase Quid acquires Rival IQ, December 2021](https://www.rivaliq.com/blog/netbase-quid-acquires-rival-iq/)
