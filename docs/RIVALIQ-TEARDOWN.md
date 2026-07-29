# Rival IQ teardown

Catalogued from the live product on Matt's account, 28 and 29 July 2026. Every
metric, screen and widget below was read off the running app rather than from
marketing pages.

## Information architecture

    Landscape          Companies, Landscape Settings, Post Tag Manager
    Social Analytics
      Competitive public data    Cross-Channel, Facebook, Instagram,
                                 Twitter, YouTube, TikTok
      Your private data          Facebook Insights, Facebook Ads,
                                 Instagram Insights, Twitter Analytics,
                                 LinkedIn Analytics
    Social Listening   Instant Search, Saved Searches
    Discover           Twitter Discover, Instagram Discover
    Custom Dashboards  user-created, unlimited
    Reports            PPT / CSV Reports, Scheduled Exports, Downloads
    Alerts
    Account            Profile, Subscription, Company Usage,
                       Listening Usage, Receipts, Team, Connected Accounts

The split that matters is competitive public data against your private data.
Anything requiring a token an org owns lives in the second group and is never
charted against rivals. LinkedIn appears ONLY there, which is the strongest
available evidence that LinkedIn competitor data cannot be bought by anyone.

Every platform screen carries the same five tabs: Overview, Leaderboard, Social
Posts, Post Tags, Posted URLs.

## Metric vocabulary

Cross-channel:

    Audience, Audience Net Change
    Posts, Posts per Day, Posts per Month
    Engagement Total, Engagement Total per Day, Engagement Total per Month
    Engagement Total / Post
    Applause, Conversation, Amplification

Per platform the same shape is restated in the platform's own noun, which is a
small thing that makes the product feel native on each screen:

    Instagram   Followers, Followers Net Change, Posts, Posts per Day,
                Engagement Total, Engagement Total per Day,
                Engagement Total / Post, Engagement Rate by Follower
    TikTok      Followers, Followers Net Change, Videos, Videos per Day,
                Engagement Total, Engagement Total per Day,
                Engagement Total / Video, Engagement Rate by Follower,
                Views, Engagement Rate by View

TikTok is the only platform with a view-based rate, because it is the only one
where they hold a view count for competitors.

## Custom dashboard widget catalogue

Fourteen types, split by whether they describe one company or the whole set.

    Charts, focus company
      Focus Company Table
      Focus Company Metric Summary
      Focus Company at a Glance
      Focus Company Pie Chart
      Focus Company Time Series

    Charts, landscape
      Bar / Stacked
      Bar / Stacked with percent change
      Pie Chart
      Time Series
      2D Scatter Plot
      Table
      At a Glance

    Social content, focus company
      Social Posts for Focus Company
      Instagram Insights Frames
      Instagram Insights Stories

    Social content, landscape
      Social Posts

The focus-company against landscape split runs through the entire product. It
is the right primitive and worth copying exactly.

## Data policy, from their own documentation

    Twitter     last 3,200 posts        Facebook    up to 2,000
    Instagram   up to 2,000             YouTube     up to 1,000
    TikTok      up to 1,000

Post metrics are refreshed for 14 days after publication, except Twitter at 5
days. No historical audience data: collection starts the day a company is first
added. Crucially, once ANY customer adds a company, that company's data is
available to every customer, which is how they amortise collection cost across
the whole book.

## Gap analysis against Data Dumpster

### Already at parity or ahead

| Capability | Rival IQ | Data Dumpster |
|---|---|---|
| Landscape model, focus plus rivals | yes | yes |
| Cross-channel and per-platform screens | yes | yes, plus Threads and Bluesky |
| Applause, conversation, amplification | yes | yes, plus saves |
| Engagement rate by follower and by view | yes | yes |
| Social posts explorer with tags and URLs | yes | yes |
| Post tagging, rules-based | yes | yes, plus AI tagging |
| Custom dashboards | yes | yes |
| Alerts | yes | yes |
| Story-level clustering | no | yes |
| AI briefs with verified claims | no | yes |
| Bring your own model | no | yes |
| Metric definitions shown in the UI | no | yes |

### Missing, ranked by how much it matters

**1. Scheduled exports and PPT output.** They generate PowerPoint and CSV on a
schedule and mail it. This is how the product reaches people who never log in,
and it is the single biggest gap. Our Weekly Report builder covers the content
but only produces clipboard HTML on demand.

**2. Social listening.** Instant Search and Saved Searches run keyword queries
across public posts rather than across tracked accounts. This answers "who is
talking about us" as opposed to "what did our rivals post", which is a
different question and one no part of our tool addresses.

**3. Discover.** Twitter Discover and Instagram Discover surface accounts you
are not tracking but probably should be. Account discovery, not measurement.

**4. Owned-account private data.** Facebook Insights, Facebook Ads, Instagram
Insights, Twitter Analytics, LinkedIn Analytics. Reach, impressions and spend
that only a token holder can see. We read owned channels but do not pull the
insights endpoints, so reach and impressions are missing everywhere.

**5. Per-platform metric naming.** They say Videos on TikTok and Posts on
Instagram. We say Posts everywhere. Small, cheap, and it is the difference
between a tool that feels built for a platform and one that feels generic.

**6. Company usage and listening usage meters.** They show what you are
consuming against your plan. With a metered vendor underneath us this matters
more for us than it does for them.

### Deliberately not copying

**Data pooling across customers.** Their economics depend on one customer's
addition benefiting everyone. A single-tenant internal tool has no such
leverage, which is precisely why our per-company cost is higher and why the
build-versus-buy memo lands where it does.

**Runaway percentage changes.** They will print "engagement up 265,895.2%"
against a near-zero baseline. We return null and say so.

**Leaderboard-first design.** Ranking 22 companies on engagement total is a
chart nobody acts on. Story-level and desk-level views are the replacement.

## Build order

1. Scheduled exports: PPT and CSV on a cron, delivered to Slack or email.
   Closes the largest gap and matches the artefact Matt already sends weekly.
2. Per-platform metric naming. An afternoon.
3. Vendor usage meter in Settings from the free units endpoint.
4. Owned-account insights for the Globe's own channels, which unlocks reach and
   impressions and makes the private-data half of the product real.
5. Social listening, if keyword monitoring is genuinely wanted. It is a
   different product and should be costed as one.
