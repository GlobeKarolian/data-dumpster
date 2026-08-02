# Data Dumpster: product requirements

**Owner:** Matt Karolian
**Status:** v1 built and deployable. This document describes what exists, what
comes next, and what will not be built.
**Last updated:** July 2026

---

## 1. The problem

A newsroom social team makes roughly forty publishing decisions a day and has
almost no comparative evidence for any of them. The platform-native dashboards
(Meta Business Suite, YouTube Studio, LinkedIn page analytics) show you your own
numbers in isolation. They cannot tell you whether a flat week was a Globe
problem or a category problem. That distinction is the entire job.

Three specific failures follow from that gap.

**Nobody can tell a soft week from a soft market.** Engagement drops 18 percent.
Without the competitive set, the social editor cannot know whether that is a
content problem worth fixing or a platform algorithm change that hit everyone.
The two responses are opposite and both are expensive if you pick wrong.

**Cross-company comparisons get made badly.** The comparisons that do happen use
whatever number is easiest to get, which is almost always total engagement or
follower count. Both scale directly with audience size, so a national outlet
beats a metro daily on them regardless of whether the content is any good. Real
decisions get made on numbers that are structurally unfair.

**The competitive read costs a person a day a week.** Somebody screenshots
competitor accounts, pastes into a spreadsheet, and writes a summary. The work is
real and the output is stale by the time it is circulated.

There is also a 2026-specific problem. The competitive social data market got
materially worse between 2024 and 2026. CrowdTangle closed on 14 August 2024,
the Meta Content Library that replaced it excludes for-profit organisations, X
moved to metered pricing, and TikTok's Research API bars commercial use. Any
honest newsroom competitive tool built today has large blind spots. The
difference between a good one and a bad one is whether it tells you where they
are. Full detail in "docs/DATA-ACCESS.md".

### Why this is a wedge and not a toy

Competitive social data is the smallest thing worth building that touches every
part of the audience business. It needs multi-platform ingestion, an honest
metric layer, a normalisation model, a tagging taxonomy that maps to desks, and
a way to put AI in front of executives without being wrong in public. Every one
of those is reusable. The same ingestion and metric layer serves owned-channel
reporting, newsletter and podcast measurement, and content-to-subscription
attribution. Starting with competitive intelligence means starting where the
data is public, the stakes are low, and nothing is load-bearing on revenue while
the plumbing is proven.

---

## 2. Users and jobs

### Social editor (primary, daily)

The person publishing. Uses Data Dumpster two to four times a day.

- When a post underperforms, I want to know whether the whole category was flat
  that day, so I do not rewrite a strategy over one bad afternoon.
- When a competitor's post explodes, I want to see the post itself within the
  hour, so I can decide whether we cover the same thing.
- When I plan next week, I want to know which desks and formats have actually
  outperformed our own baseline, not the industry average.

Screens: Social Posts (with outlier score), per-platform overviews, Alerts.
The outlier score matters more than any leaderboard for this user, because it is
relative to that account's own median rather than to anyone else's scale.

### Audience development lead (primary, weekly)

Owns the number. Uses Data Dumpster weekly and before every planning cycle.

- I want one fair cross-company comparison I can put in front of the masthead
  without having to defend the denominator.
- I want to know what competitors are linking to, so I can see their traffic
  strategy rather than just their social output.
- I want the weekly competitive summary to write itself, correctly, so I spend
  the time on the decision instead of on the deck.

Screens: Cross-Channel, Leaderboards, Posted URLs, Briefs, Dashboards.

### Newsroom executive (secondary, weekly to monthly)

Reads, does not operate. Might never open the tool.

- I want a page of prose that tells me what changed and what to do, that I can
  forward without editing.
- I want to be able to check any number in it in under a minute if challenged.

Surface: the weekly brief, delivered. The verification panel exists for this
user specifically. When a claim is questioned in a meeting, the answer is a
fact-sheet path, not "the tool said so".

### CTO / platform owner (tertiary, continuous)

- I want to know what this costs, per month, itemised, without a support ticket.
- I want to know where the newsroom's content goes when an AI feature runs.
- I want to add a platform or swap a model without a vendor conversation.

Surfaces: Settings (model connections with real spend, per-org encrypted
credentials), the ingestion runs table, "docs/ARCHITECTURE.md".

---

## 3. The metric model

Metrics live in exactly one place, "src/lib/metrics/definitions.ts", and the UI
renders each definition, its plain-language formula, and its caveat in a tooltip
on the label. A competitive analytics tool that will not tell an executive how it
computed a figure is a tool nobody trusts twice.

### The vocabulary

Platform-native reaction names are normalised at the adapter boundary into four
buckets, so that a Bluesky repost and an X retweet land in the same column.

- **applause**: likes, reactions, favourites, hearts, upvotes
- **conversation**: comments, replies
- **amplification**: shares, retweets, reposts, quotes
- **saves**: saves and bookmarks, where exposed
- **views**: video or impression views, where exposed
- **engagementTotal**: applause plus conversation plus amplification plus saves

Derived: engagementPerPost, engagementRateByFollower, engagementRateByView,
audienceNetChange, audienceGrowthRate, postsPerDay, postsPerWeek, viewsPerPost,
shareOfVoice, shareOfEngagement.

### Why engagement rate by follower is the headline

It is the only metric in the system that is genuinely fair across companies with
different audience sizes. Total engagement, engagement per post, applause and
views all scale with how many followers a brand already has. Put a 4,000,000
follower national outlet and a 40,000 follower metro daily in the same table and
the national outlet wins every one of those columns regardless of whether its
content is better. Dividing engagement by followers and by posts divides that
advantage back out and leaves something close to a content-quality signal.

It is not perfect and the tooltip says so. Two honest limits ship in the product:
it is undefined for any channel with no follower reading, and it flatters very
small accounts whose handful of loyal followers all engage.

The alternative would be engagement rate by view, which is a truer read because
it measures against people who actually saw the content rather than people who
could have. It is unusable here. No public API exposes impressions for content
you do not own, on any platform, so the metric is undefined for essentially every
competitor. Data Dumpster stores it as NULL rather than 0 in that case, so the metrics
layer can distinguish "not exposed" from "nobody engaged".

### Rules that are enforced in code, not in a style guide

- Audience is a stock, not a flow. Widening the date range changes which day the
  snapshot comes from, never the magnitude. The tooltip says this because it is
  the single most common misreading of a social dashboard.
- Growth rate is blank, not enormous, when the starting audience was zero.
- Percent changes above 1000 percent are never printed as figures anywhere in the
  product. They are always a near-zero baseline. Rival IQ will print
  "engagement up 265,895.2%" without blinking. The verifier in
  "src/lib/ai/verify.ts" treats printing one as a rule violation.
- Share of voice and share of engagement move when the landscape membership
  changes, without anyone changing behaviour. The caveat ships with the number.

---

## 4. Feature inventory

### Now (built and in the repository)

**Landscapes.** A named competitive set: one focus company plus N competitors.
Multi-tenant from the first migration, so Globe, Boston.com and STAT can be
separate orgs or separate landscapes inside one org without a fork.

**Companies and channels.** A company has zero or more channels, one per
platform handle. Channels carry an isOwned flag, which changes which read path
the adapter takes on Instagram, TikTok and LinkedIn.

**Ingestion.** Eight adapters behind one interface: Facebook, Instagram, X,
YouTube, TikTok, LinkedIn, Bluesky, RSS. A registry that makes adding a platform
one file plus one line. A runner that is idempotent, chunks writes under the
Postgres bind-parameter limit, isolates per-channel failures, and records every
run in an ingestion_runs table with API call counts.

**Cross-Channel overview.** Four headline stats with prior-period deltas and
sparklines, platform mix against the landscape average, best post per platform.

**Per-platform overviews.** Facebook, Instagram, X, YouTube, TikTok, Bluesky.

**Leaderboards.** Any metric, ranked across the landscape, current versus prior.

**Social Posts explorer.** Filter by company, platform, post type, date range,
tag and free text. Sort by any engagement column or date. Paginated. CSV export.
Each row carries an outlier score against that company's own platform median.

**Post Tags.** Rule-based (keywords, hashtags, platforms, post types, URL
domains, URL path fragments, regex) evaluated at ingest time, plus AI tagging
against a natural-language description. The AI tagger uses a closed JSON Schema
with an enum of real tag ids, so a provider with strict structured output cannot
return a tag that does not exist. Every AI tag carries quoted evidence from the
post and a confidence score.

**Posted URLs.** Every link extracted from every post, grouped by domain or by
URL, with post counts, engagement and which companies posted it.

**Custom dashboards.** Saved widget layouts scoped to a landscape, optionally
published at an unguessable share token for read-only external viewing.

**Alerts.** Seven kinds: competitor outlier, audience swing, volume drop, new
channel, keyword hit, share-of-voice shift, custom. Evaluated hourly, deduplicated
on a stable key, delivered to Slack or email.

**Weekly briefs.** Fact sheet computed in SQL, model narrates it, deterministic
verifier checks every number against the sheet, one repair pass on failure, then
markdown plus fact sheet plus verdict stored together in one row.

**Ask.** Natural-language questions over the same fact sheet, with explicit
refusal and a statement of what filter would produce the missing figure.

**Bring-your-own-model.** Six working providers (Anthropic, OpenAI, Google,
Azure OpenAI, any OpenAI-compatible endpoint, Ollama) plus Bedrock present and
failing loudly with the workaround. Per-call token and cost metering into an
ai_usage table, and a spend panel in Settings that reads from it.

**Security.** Auth.js v5 credentials sign-in, edge middleware that verifies the
JWT signature rather than looking for a cookie, org scoping enforced in the
session layer on every handler, AES-256-GCM encryption at rest for every platform
token and model key, constant-time bearer comparison on the cron routes.

### Next (the first quarter of real use)

1. **Per-platform refresh windows.** The engagement refresh overlap is a two-day
   constant in "runner.ts". On metered X it is the single biggest cost lever in
   the system. It should be a per-platform setting with the cost shown next to it.
2. **Reddit rollout.** The EnsembleData adapter is implemented. Confirm the
   commercial-use terms are covered, attach the first user accounts and
   communities, and measure vendor cost and coverage before broad rollout.
3. **Owned-channel depth.** Meta and LinkedIn owned tokens unlock impressions,
   reach, clicks and saves for our own accounts. Different question from the
   competitive one, same pipes, high value to the social team.
4. **Scheduled delivery.** Briefs and dashboard snapshots to Slack and email on a
   schedule, not just on demand. The cron already exists; the delivery routing
   does not.
5. **Desk and vertical rollups.** Tags exist and map to desks. Rolling them into
   a per-desk scorecard is a query and a screen, not new infrastructure.
6. **Benchmarks.** Percentile bands for engagement rate by follower across the
   tracked set, so a number has a reference point without a competitor being
   named.

### Later (only if the first quarter earns it)

- **Content-to-outcome attribution.** Join posted URLs against the Globe's own
  analytics and subscription events. This is the version of the product that
  pays for itself, and it is the reason to build the posted-URL layer now.
- **Ingest history import.** Any archived competitor data the Globe already has,
  loaded into the same schema, to shorten the history gap against incumbents.
- **Sentiment and topic clustering.** Only with the same evidence discipline as
  tagging. A sentiment score with no quoted evidence is a number nobody can check.
- **Multi-brand rollup.** One view across Globe, Boston.com and STAT. The schema
  supports it today; the navigation does not.
- **Read-only API.** For pulling Data Dumpster numbers into other Globe tooling.

---

## 5. Non-goals

Stated so nobody has to relitigate them.

**Not a publishing or scheduling tool.** Data Dumpster does not post. It never holds a
write token. That is a different product with a different risk profile and there
are good ones already.

**Not social listening.** Brand mention monitoring across the open web is a
separate data problem with separate vendors. Data Dumpster measures published channel
performance, not conversation about the brand.

**Not paid media reporting.** Facebook Ads reporting is a real Rival IQ feature
and Data Dumpster will not have it. If the Globe needs paid social reporting, that is
an argument for buying, and it is in "docs/BUILD-VS-BUY.md".

**No estimated or modelled metrics.** Rival IQ sells AI-estimated impressions.
Data Dumpster will not ship one. An estimate presented alongside measured numbers gets
treated as measured within one meeting, and the entire trust argument for this
product collapses the first time somebody discovers a headline figure was
inferred. Blanks and labelled gaps only.

**No scraped data.** Where an API forbids competitor access, Data Dumpster reports the
gap. A vendor could sell scraped TikTok data. It breaks without warning, and it
is not defensible if the Globe is ever asked where a number came from.

**Not a hosted multi-customer SaaS.** It is multi-tenant so Globe brands can
coexist. It is not a business.

**No hosted model.** Data Dumpster will never ship inference. If it did, every
argument in "docs/BYO-MODEL.md" would be false.

---

## 6. Success metrics for the tool itself

A competitive intelligence tool that nobody opens is worse than no tool, because
it costs money and creates the belief that the question is handled. These are the
numbers to hold it to, and where each is already measurable.

### Adoption

| Measure | Target by day 90 | Source |
|---|---|---|
| Weekly active users on the social team | 6 of 8 | users.lastSeenAt |
| Briefs opened within 48 hours of generation | 70 percent | needs a view-event table, not built |
| Alerts acknowledged rather than ignored | 50 percent | alertEvents.acknowledgedAt |
| Dashboards created by someone other than the builder | 3 | dashboards.createdAt by user |

The third row is the honest one. Alert acknowledgement rate is the fastest
signal that alerting is tuned wrong, and it is the first thing that goes bad.

### Trust

| Measure | Target | Source |
|---|---|---|
| Briefs passing verification on the first pass | 90 percent | briefs.facts, verification.ok |
| Briefs passing after one repair | 98 percent | same, generation.repaired |
| Numeric claims grounded per brief | 100 percent | verification.stats |
| Numbers disputed in a meeting and found wrong | 0 | manual log |

The last row cannot be instrumented and is the one that decides whether this
survives. Track it by hand for the first quarter.

### Operations

| Measure | Target | Source |
|---|---|---|
| Ingestion runs succeeding | 98 percent | ingestionRuns.status |
| Median hours from post published to visible | under 3 | postedAt vs firstSeenAt |
| Monthly data acquisition cost | under 250 dollars | ingestionRuns.apiCalls |
| Monthly model spend | under 50 dollars | aiUsage.costUsd |
| Cross-Channel p75 load | under 1.5 seconds | Vercel analytics |

### The one that matters

**Decisions changed.** Count the times a Data Dumpster number altered what got
published, what got promoted, or where a person was assigned. Target is four a
quarter, which sounds low and is not. This has to be logged manually, in a shared
doc, by the audience development lead. There is no instrumentation for it and
inventing a proxy would be exactly the kind of dishonest metric this product
exists to avoid.

---

## 7. Open questions

**Which landscape is the real one.** The seed ships two (Boston News Landscape,
Globe Owned Brands). The right competitive set for the Globe is a judgement call
that belongs to the audience team, and the answer changes share of voice and
share of engagement for everybody in it. This should be decided by a person, on
the record, before the first brief circulates.

**Whether X is worth paying for.** Metered X for a dozen competitor accounts is
roughly 180 dollars a month at a three-day refresh window, with medium confidence
on the rate. The measurement is whether an X-sourced number ever changes a
decision in the first quarter. If not, drop it and save the line item.

**How much history matters.** Rival IQ's genuine advantage is a decade of stored
time series. Data Dumpster starts at zero. The open question is whether newsroom
decisions actually depend on 24-month comparisons or on 90-day ones. My read is
90 days, but I have not tested it, and if I am wrong that is a real argument for
buying.

**Where the Facebook blind spot bites.** Facebook competitor data is not
obtainable. The question is whether RSS plus cross-platform inference covers the
decisions that used to be made on CrowdTangle data, or whether there is a class of
question the Globe simply can no longer answer. Worth writing down explicitly
after a quarter of use.

**Who owns the metric dictionary.** Definitions are in code, which is correct for
consistency and wrong for editorial ownership. At some point a person in the
newsroom needs to be the one who approves a change to what "engagement" means.
The process for that does not exist yet.

**Whether AI tagging is good enough to trust unreviewed.** It carries evidence
and confidence, and the prompt is deliberately conservative. Nobody has measured
its precision on Globe content. Do that on 200 posts before turning it on for
anything that feeds a report.
