# Rival IQ teardown

Catalogued from the live product on Matt's account, 28 and 29 July 2026. Every
metric, screen and widget below was read off the running app rather than from
marketing pages.

**Dating note.** The Rival IQ observations remain a 28–29 July 2026 snapshot.
Data Dumpster implementation status was rechecked on 3 August 2026 against the
current checkout and `HANDOFF.md`. Status annotations below do not claim that
Rival IQ itself was re-audited on 3 August.

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
charted against rivals. LinkedIn appeared only there in the 28–29 July Rival IQ
snapshot. That describes Rival IQ's product navigation; it does not establish
market availability. Data Dumpster now collects public LinkedIn company pages
through Bright Data: follower stock, posts, likes and comments only, with every
history window source-limited.

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
| Cross-channel and per-platform screens | yes | yes, plus Threads, Bluesky and Reddit |
| Applause, conversation, amplification | yes | yes, plus saves |
| Engagement rate by follower and by view | yes | yes |
| Social posts explorer with tags and URLs | yes | yes |
| Post tagging, rules-based | yes | yes, plus AI tagging |
| Platform-native metric and publication names | yes | yes: Videos/Subscribers where appropriate, Posts/Followers elsewhere |
| Custom dashboards | yes | yes |
| Alerts | yes | yes |
| Scheduled PowerPoint and CSV delivery | yes | yes: email, tenant-bound Slack links, run-now and delivery audit; dispatcher schedule currently inactive |
| Reuse of public account data across landscapes | yes | yes in the current checkout: one pooled channel, history and collection job serve organization-private landscape demand |
| Story-level clustering | no | yes |
| AI briefs with verified claims | no | yes |
| Bring your own model | no | yes |
| Metric definitions shown in the UI | no | yes |

### Missing, ranked by how much it matters

**1. Social listening.** Instant Search and Saved Searches run keyword queries
across public posts rather than across tracked accounts. This answers "who is
talking about us" as opposed to "what did our rivals post", which is a
different question and one no part of our tool addresses.

**2. Discover.** Twitter Discover and Instagram Discover surface accounts you
are not tracking but probably should be. Account discovery, not measurement.

**3. Owned-account private data.** Facebook Insights, Facebook Ads, Instagram
Insights, Twitter Analytics, LinkedIn Analytics. Reach, impressions and spend
that only a token holder can see. We collect owned brands through the same
public-comparable path as rivals, but the pooled runner deliberately excludes
owner tokens and does not pull insights endpoints, so reach and impressions are
missing everywhere.

**4. Vendor, company and listening usage meters.** Rival IQ shows what customers
consume against their plan. Data Dumpster now has a dollar-spend panel for AI
model usage, but it still lacks an acquisition-vendor unit meter and the
company/listening plan meters described here. With metered public-data vendors
underneath us, the vendor meter matters more for us than it does for them.

### Deliberately not copying

**Runaway percentage changes.** They will print "engagement up 265,895.2%"
against a near-zero baseline. We return null and say so.

**Leaderboard-first design.** Ranking 22 companies on engagement total is a
chart nobody acts on. Story-level and desk-level views are the replacement.

### Decision revised after the original teardown

**Public-data pooling.** The 29 July teardown classified Rival IQ's pooling as
something a single-tenant internal tool would not copy. That conclusion no
longer describes Data Dumpster. Public companies, channels, posts, audience
history and collection state are intentionally reusable across organizations.
Each landscape keeps private demand, membership, tags, dashboards and briefs;
the shared control plane collapses overlapping demand to one channel window and
one crawl. Adding the same brand to another landscape therefore reuses retained
history and fresh coverage instead of buying the data again. Owner-only tokens
are excluded from that pooled path, and owner-private observation storage is
still a release gate. The pooling implementation is present in the current
checkout; migration and deployment validation remain a release step in
`HANDOFF.md`.

## Original build order, status checked 3 August 2026

1. Scheduled exports: PPT and CSV on a cron, delivered to Slack or email.
   **Implemented:** the report screen, PowerPoint, sectioned CSV, email,
   tenant-bound Slack links, run-now and a destination-level delivery audit all
   use the stored report document. The delivery dispatcher schedule is inactive
   until its environment and spend/operations decision are approved.
2. Per-platform metric naming. **Implemented:** TikTok and YouTube use video
   language, YouTube uses subscribers, Reddit uses members/score/comments/
   crossposts, and the remaining platforms retain post/follower language.
3. Vendor usage meter in Settings from the free units endpoint. **Open.** The
   model-usage dollar panel is separate and does not report acquisition units.
4. Owned-account insights for the Globe's own channels, which unlocks reach and
   impressions and makes the private-data half of the product real. **Open and
   gated on the owned-data isolation work in `HANDOFF.md`.**
5. Social listening, if keyword monitoring is genuinely wanted. It is a
   different product and should be costed as one. **Open.**
