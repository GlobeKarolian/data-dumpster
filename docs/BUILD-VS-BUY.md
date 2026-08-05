# Build versus buy: Data Dumpster and Rival IQ

**Audience:** whoever signs for either one.

**Dating note, updated 4 August 2026.** The Rival IQ prices and original Data
Dumpster cost model remain a July snapshot. The operative source policy has
changed: Bright Data is the purchased primary for existing Facebook and for
Instagram, TikTok, X, Threads and LinkedIn whenever configured; EnsembleData is
the Reddit publisher-user source, X onboarding helper and no-Bright fallback for
Instagram, TikTok, X and Threads. A paid Bright stage never falls through after
it starts or fails. YouTube and Bluesky remain official public sources. Current
vendor spend must be measured rather than inferred from the historical X-only
estimate below.

**Bottom line up front.** On pure cost, buying Rival IQ is cheaper than
maintaining Data Dumpster, once an engineer's fully loaded time is counted honestly.
The case for building does not rest on cost and anyone who tells you it does has
not done the arithmetic. It rests on four capabilities Rival IQ cannot supply at
any price, and on whether the Globe wants competitive social data to be a
purchased report or the first layer of an owned data platform. Section 6 has the
recommendation, including the conditions under which the right answer is to write
the cheque.

---

## 1. What Rival IQ costs

From their own published pricing page, read on 28 July 2026. Prices are monthly,
in USD, with 15 percent off for annual commitment.

| Plan | Price | Tracked companies | History | Users |
|---|---|---|---|---|
| Drive | 239 | 10 | 6 months | 1 |
| Engage | 349 | 20 | 12 months | 2 |
| Engage Pro | 559 | 40 | 24 months | 5 |
| Enterprise | not published | volume | | |

Add-ons: 5 more tracked companies for 50 a month, extra users at 10 a month each.
A tracked company includes one handle on each of the networks they monitor. There
is a 14-day free trial and no minimum commitment on monthly plans.

**A caveat on that table.** The pricing page's own metadata shows a last-modified
date of December 2024, and the site footer reads 2025. The prices are what the
page serves today, but they may not have been reviewed recently, and enterprise
is quoted separately and is not published. Do not build a business case on the
last row. **Confidence: high on the three published tiers, none on enterprise.**

Rival IQ is now a Quid company, per their own footer, which is worth knowing
because acquired analytics products have a habit of being repriced.

### A realistic Globe configuration

Boston Globe Media would want the Globe, Boston.com and STAT tracked, plus a
competitive set of Boston and national outlets, plus a handful of national
comparators. Call it 25 to 35 companies and 6 to 10 people who should have a
login.

That is Engage Pro at 559 a month, with 5 extra users at 10 each, so **609 a
month, or about 7,300 a year, or about 6,200 on an annual commitment.** For a
40-company, 10-seat competitive analytics platform with a decade of history
behind it, that is not an unreasonable price. It is worth saying that plainly,
because a build-versus-buy document that treats the incumbent's price as
outrageous is not a document anyone should trust.

---

## 2. What Rival IQ does well that Data Dumpster does not

This list is longer than the one after it, and that is the honest shape of it.

**A decade of history.** Rival IQ has been collecting since roughly 2013.
Twenty-four months of stored competitor time series on Engage Pro, and behind
that an archive including CrowdTangle-era Facebook data that no longer exists
anywhere else. **This cannot be replicated.** Data Dumpster starts its clock the day
you run the ingest, and no amount of engineering shortens that. If a decision
needs a 2019 comparison, there is exactly one place to get it.

**Social listening.** Instant Search across Reddit, X, blogs and millions of
other sites, plus saved searches for always-on brand and competitor monitoring.
Data Dumpster does not do this and it is an explicit non-goal. It is a different data
problem with different vendors, and it is genuinely useful.

**Paid social reporting.** Facebook Ads reporting and alerting, boosted post
analytics, and machine-learning detection of whether a competitor boosted an
organic post. Data Dumpster has none of this. If the Globe's audience team needs paid
and organic in one interface, that is a clean argument for buying.

**Estimated impressions.** They model impressions for competitors on all
channels. Data Dumpster deliberately refuses to ship an estimated metric. That is a
principled position and it is also a missing feature, and reasonable people
prefer a labelled estimate to a blank.

**Reporting polish.** One-click branded exports to PowerPoint, PDF, PNG and CSV,
scheduled delivery, embeddable links, a Looker Studio connector, and a custom
chart builder. Data Dumpster has CSV export and share links. The gap between "I can
get the data out" and "I can put a client-ready deck in front of a publisher in
thirty seconds" is real work that is not done here.

**Industry benchmarks.** Their published benchmark reports and live industry
benchmarks give a reference point that no internal tool has, because it requires
a panel of companies you do not track.

**Somebody else's on-call.** When Instagram changes an endpoint at 2am, that is
Rival IQ's problem. They also carry the Meta App Review and platform partnership
burden, so a customer OAuths into an already-approved app instead of spending
weeks in review. That is a genuine, underrated advantage and it is worth money.

**Time to value.** A trial gets you charts this afternoon. Data Dumpster is live,
but every purchased source still needs explicit Legal/procurement approval,
configuration and ongoing coverage monitoring.

---

## 3. What Data Dumpster does that Rival IQ cannot

Shorter list, and each item is structural rather than a matter of engineering
effort. These are things a vendor with a SaaS business model has a positive
reason not to build.

**Bring your own model, including fully on-premises.** All AI runs on inference
the Globe controls: an existing enterprise agreement, an Azure deployment, or an
Ollama box behind the firewall with no network egress. No newsroom content goes
to a model the newsroom did not choose. A hosted product cannot offer this,
because their AI feature is a margin line. See "docs/BYO-MODEL.md".

**Verified AI output with an audit trail.** Every number in a Data Dumpster brief
carries the fact-sheet path it came from, a deterministic checker verifies each
one before a human sees it, and the brief is stored with the exact fact sheet the
model saw and the verification verdict. When a number is challenged in a meeting,
the answer is a path, not "the tool said so". Ask any vendor selling AI social
summaries what happens when their model states a number that is not in the data.
The answer should be a mechanism.

**Metric honesty as a product decision.** Every metric label carries its
definition, its plain-language formula, and its caveat. Growth rate is blank
rather than enormous when the baseline was zero. Percent changes above 1000
percent are never printed. Views of 0 means "not exposed", never "nobody saw it".
Platforms that cannot serve competitor data are labelled rather than charted as
zero. A commercial tool has a commercial incentive to show a number, and it shows.

**Your database, joinable to your other data.** The Postgres is yours. Posted
URLs can be joined to the Globe's own analytics and subscription events, which is
the version of this product that actually pays for itself. Rival IQ offers API
access as an Engage Pro add-on; it is a data export, not a warehouse you own.

**Bluesky.** Rival IQ's published channels are TikTok, Instagram, Facebook, X,
LinkedIn and YouTube. Bluesky is not among them. For a journalism-adjacent
audience in 2026, and given that Bluesky is the one platform serving full,
unrestricted, free competitor data, that is a meaningful gap.
**Confidence: high that it is not on their channels page; medium that they have
not shipped it since.**

**Posted-URL analysis as a first-class input.** What a competitor is driving
traffic to, on which desk and at what cadence. This is the newsroom-native part.
RSS is deliberately retired; social post URLs supply the publishing connection
without creating a second, engagement-free dataset.

**No per-seat cost.** Every person at the Globe can have a login. The tool gets
cheaper per user as it succeeds, rather than more expensive.

**Extensibility.** Adding a platform is one file and one registry line. Adding a
model provider is one file and one table entry. Neither requires a vendor
conversation or a roadmap request.

---

## 4. Total cost of ownership for Data Dumpster

The build is done, so this is the cost of running it from here. All figures
monthly.

### Cash costs

The table below is the original July estimate and is retained for the decision
record. Its X-API assumption is not current routing, and its subtotal is not a
current budget. The live source mix has Bright Data spend across six platforms
and EnsembleData spend for Reddit or no-Bright fallbacks; use vendor billing and
ingestion audits to replace these rows before making a purchase decision.

| Line | Monthly | Confidence |
|---|---|---|
| Vercel, Pro tier, 1 to 2 seats | 20 to 40 | High |
| Neon Postgres, Launch tier, under 5 GB | 19 to 30 | High |
| Bluesky, YouTube and the then-planned owner APIs | 0 | Historical assumption |
| X API, metered, 12 competitor accounts, 3-day refresh window | about 180 | Historical assumption; not the current X route |
| Model inference, 50 briefs plus ask and tagging, mid-tier model | 5 to 15 | High. Derived from published prices in docs/BYO-MODEL.md |
| **Cash subtotal** | **225 to 265** | |

Infrastructure is not the story. The X line is more than half the cash cost, it
is the only line that scales with the number of competitors tracked, and it is
optional. Drop X and the cash cost is about 50 dollars a month.

### Engineering time, which is the actual cost

This is where a build-versus-buy document usually cheats, by pricing the servers
and calling the engineering free.

**Steady-state maintenance: 4 to 8 hours a month.** Almost all of it is adapter
breakage. Platform APIs change without notice, deprecate versions on a schedule,
and rotate auth requirements. Eight adapters across seven platforms means
something breaks a few times a year per platform. Each break is a few hours to
diagnose and fix, and the runner's per-channel failure isolation means a break
degrades one platform rather than taking down the product, which buys time but
does not remove the work.

**Feature work, if it is a living product: 8 to 16 hours a month.** The Next list
in the PRD is real work: per-platform refresh windows, a Reddit adapter,
owned-channel depth, scheduled delivery, desk rollups.

**Call it 0.1 to 0.15 FTE.** At a fully loaded senior engineer cost in the range
of 200,000 to 250,000 dollars a year, that is roughly **1,700 to 3,100 dollars a
month.**

**One thing that is genuinely missing and should be priced in.** There is no test
suite. Zero test files in the repository. TypeScript strict passes with no errors
across all 183 files, which catches a large class of problems, and the metric
layer is the part that most needs tests and does not have them. Retrofitting
meaningful coverage over "src/lib/metrics/queries.ts", "src/lib/ai/verify.ts" and
the adapter normalisers is roughly a week of work, once. Do it before anyone
makes a decision on a Data Dumpster number that they would not make on a spreadsheet.

### The comparison, stated fairly

| | Data Dumpster | Rival IQ Engage Pro, 10 seats |
|---|---|---|
| Cash per month | 225 to 265 | 609 |
| Engineering per month | 1,700 to 3,100 | 0 |
| **Total equivalent** | **1,925 to 3,365** | **609** |
| Cost at 100 tracked companies | roughly unchanged, plus X metering | 1,159 |
| Cost at 20 users | unchanged | 759 |
| Time to first chart | a day for open platforms, weeks for Meta | this afternoon |

**Rival IQ is three to five times cheaper.** That is the honest read and it does
not flip at any realistic scale, because the engineering time dominates and it
does not go away.

The counter-arguments, which are real but should be labelled as counter-arguments
rather than smuggled into the table:

The 0.1 FTE is not purely a cost if the engineer is building capability the Globe
needs anyway. The ingestion layer, the metric layer, and the model abstraction
are the same infrastructure a first-party audience data platform needs. Priced as
"the competitive tool costs 0.1 FTE", it looks expensive. Priced as "0.1 FTE
maintains the foundation of the data platform and produces the competitive tool
as a by-product", it looks different. Whether that reframe is honest depends
entirely on whether the Globe actually builds the rest of it.

And the marginal cost of an internal tool that already exists is different from
the cost of deciding to build one. That decision has been made and paid for. The
question in front of anyone reading this is whether to maintain it, not whether
to start it.

---

## 5. What each one is actually good at

Compressed, for a slide.

| | Data Dumpster | Rival IQ |
|---|---|---|
| Competitive metrics on open platforms | Yes | Yes |
| Facebook competitor data | Bright Data for existing pooled profiles; new onboarding temporarily disabled | Thin, post-CrowdTangle |
| TikTok competitor data | Bright Data when configured; EnsembleData only when Bright Data is absent | Present, provenance unclear |
| LinkedIn competitor data | Bright Data public company pages: followers, posts, likes and comments; history always source-limited | Present, provenance unclear |
| X and Threads competitor data | Bright Data when configured; EnsembleData only when Bright Data is absent | X present; Threads not listed in the July audit |
| Bluesky | Yes | Not on their channels page |
| History depth | From today | Up to 24 months, decade behind it |
| Social listening | No | Yes |
| Paid social and boosted-post detection | No | Yes |
| Estimated impressions | Refuses on principle | Yes |
| Branded PowerPoint and PDF export | No | Yes |
| Industry benchmark panels | No | Yes |
| Metric definitions and caveats in-product | Yes | Partial |
| AI briefs with verified, cited numbers | Yes | Not published |
| Bring your own model, on-prem option | Yes | No |
| Per-seat cost | None | 10 per extra user |
| Owns the underlying database | Yes | No |
| Joinable to first-party subscription data | Yes | Export only |
| Somebody else is on call | No | Yes |

---

## 6. Recommendation

### Buy Rival IQ, and do not build, if any of these are true

**There is no named engineer who owns this.** This is the decisive condition and
it is not close. An internal tool with no owner is worse than no tool: it degrades
silently as adapters break, and people keep trusting numbers that stopped
updating in March. If the answer to "who fixes this when Instagram changes an
endpoint" is a shrug, buy.

**Paid social reporting is in scope.** Facebook Ads reporting and boosted-post
detection are not on the Data Dumpster roadmap and should not be. That alone justifies
a licence.

**Social listening is in scope.** Same reasoning.

**A decision depends on history the Globe does not have.** If somebody needs to
compare 2026 against 2019, only Rival IQ can answer, and no build changes that.

**It is needed in two weeks.** Meta App Review takes weeks and can be refused.
Rival IQ has already done it.

**Nobody has an AI governance requirement.** If no category of Globe content
needs to stay inside the building, the strongest single argument for Data Dumpster
does not apply.

### Build, and maintain Data Dumpster, if these are true

**An engineer owns it and wants to.** Necessary, not sufficient.

**The AI governance requirement is real.** Pre-publication, source-adjacent or
legally sensitive material passing through an AI feature is the argument that no
amount of vendor money solves.

**Social data needs to join first-party data.** Content-to-subscription
attribution is the version of this that pays for itself, and it requires owning
the database.

**Bluesky matters.** For a journalism audience in 2026, and for honest
competitive comparison generally, it is the best data source available and it is
free.

**This is the first layer of something larger.** If competitive intelligence is a
wedge for an owned audience data platform, the 0.1 FTE is foundation work. If it
is the whole ambition, it is overhead.

### What I would actually do

**Run both for one quarter, then decide with evidence.**

Buy Rival IQ Drive at 239 a month for three months. That is 717 dollars total and
it buys three things: the history and benchmark panels Data Dumpster cannot produce, a
running check on whether Data Dumpster's numbers agree with a commercial tool's, and a
fallback if the build stalls.

Run Data Dumpster in parallel on the sanctioned public sources: Bluesky and
YouTube. Keep purchased Bright Data and EnsembleData paths disabled until their
Legal/procurement decisions and spend controls are recorded. Start the history
clock on approved sources immediately, because that clock is the one thing that
cannot be bought later.

At the end of the quarter, three questions answer it. Which tool did people
actually open. Did the AI governance argument ever come up in a real situation, or
did it stay theoretical. Did anyone need the paid social or listening features
enough to notice they were missing.

If the answer is that people used Rival IQ and nobody missed the governance
story, cancel the build and expand the licence. That would be a good outcome and
it would have cost one quarter and about 700 dollars to learn.

If the answer is that Data Dumpster got used, the briefs got forwarded, and the
governance argument came up in a real conversation, then fund it properly:
retrofit the test suite, make the refresh window a setting, add Reddit, and start
the work of joining posted URLs to subscription data. That is the version where
the competitive tool was never the point.

**What I would not do is decide this from a document.** Including this one.
