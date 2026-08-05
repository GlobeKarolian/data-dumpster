# Data Dumpster

**Matt Karolian, July 2026**

**Historical pitch, source status corrected 4 August 2026.** The build-time,
line-count and ninety-day-plan claims below describe the July artifact. The
source-access absolutes have been corrected to match the current checkout:
Bright Data is the purchased primary for existing Facebook and for configured
Instagram, TikTok, X, Threads and LinkedIn collection; EnsembleData serves
Reddit publisher-user feeds, X onboarding and no-Bright fallbacks for Instagram,
TikTok, X and Threads. A paid Bright stage never switches vendors after it
starts or fails. YouTube and Bluesky use sanctioned public interfaces, and RSS
is retired.

I built a working competitive intelligence platform for Boston Globe Media in an
afternoon. This document is why, what it argues, and what I would do with the
first ninety days of a CTO or CPO role.

Everything factual in here is checkable. The code is in this repository, the
external claims are cited, and where I am guessing I say so.

---

## 1. The strategic read

Two referral channels carried digital news for fifteen years. Both are gone.

Social referral went first. Facebook started deprioritising news around 2018 and
finished the job by shutting the News Tab. X stopped being a news distribution
system after 2022. The audience did not leave, it fragmented: some to Bluesky,
some to Threads, a large share into video on TikTok and YouTube, and a great deal
into places that send no traffic at all.

Search referral is going now. AI answers sit between the reader and the link, and
the click that used to be the whole point of ranking is increasingly optional.
Every publisher reporting numbers publicly is describing the same curve.

The consequence for a newsroom is not subtle. Distribution channels that used to
deliver readers now deliver awareness, and the only durable relationship left is
the one you own: subscription, newsletter, app, habit.

**This changes the measurement question, and most newsrooms have not changed
their measurement.** The old question was how much traffic social sent. That
question is close to meaningless now. The right question is whether the brand
holds attention in the places readers still are, relative to the people competing
for the same attention, and whether that attention eventually converts.

Almost nobody can answer that, because answering it requires competitive data,
and competitive social data got materially harder to obtain between 2024 and
2026. CrowdTangle closed in August 2024, though Meta's Page Public Content Access
still offers an approval-gated Facebook route. TikTok's research access bars
this commercial use, and LinkedIn's official organization APIs are owned-only.
Purchased public-data paths exist for all three; Data Dumpster currently uses
Bright Data for existing Facebook and public LinkedIn company pages, plus the
other configured platforms described above. The full accounting is in
"docs/DATA-ACCESS.md".

So the position for Globe Media is this. The Globe has something most metros do
not, which is a real direct-subscription business and multiple distinct brands
(the Globe, Boston.com, STAT) with genuinely different audiences. That is an
asset. What it does not have, as far as I can tell from the outside, is a shared
measurement layer that tells any of those brands how they are doing against the
people they actually compete with.

*I would replace this paragraph with real internal numbers in a live
conversation. I am not going to guess at the Globe's subscriber count or churn in
a document, and a candidate who does should worry you.*

---

## 2. Why competitive intelligence is a wedge and not a toy

I picked this problem on purpose, and the reasoning is the part I would want
evaluated.

**It is the smallest useful thing that touches every hard part of the audience
data stack.** To do it at all you need multi-platform ingestion, credential
management, normalisation across incompatible platform vocabularies, a metric
layer that survives being questioned, a tagging taxonomy that maps to how a
newsroom is actually organised, time-series storage that distinguishes a stock
from a flow, and a way to put AI in front of an executive without being wrong in
public. Every one of those is reusable. None of them is theoretical.

**The data is public and the stakes are low.** Nothing here touches subscriber
records, payment data, or anything with a retention policy. It is a place to
prove the plumbing where a mistake costs a wrong chart rather than a breach.

**The next layer is the one that pays.** Data Dumpster already extracts every URL from
every post and stores it with its domain and path segments. Joining that against
the Globe's own analytics and subscription events answers a question nobody in
this industry answers well: which content, distributed how, produced a
relationship. That is the product I actually want to build. Competitive
intelligence is how you get the ingestion, the metric discipline and the
organisational trust you need before anyone will let you near the subscription
data.

**And the immediate version is genuinely useful on its own.** A social editor who
can tell a soft week from a soft market makes better decisions than one who
cannot. That is worth building even if nothing follows it.

---

## 3. What I built, and how long it took

**183 TypeScript files. 26,433 lines under "src". Zero TypeScript errors under
strict mode.** Those are counted, not estimated, and you can reproduce them:

    find src -name '*.ts*' | wc -l
    find src -name '*.ts*' -exec cat {} + | wc -l
    ./node_modules/.bin/tsc --noEmit

**Timeframe: one afternoon.** The git history starts with a create-next-app
commit at 17:12 on 28 July 2026. The first real file, "src/db/schema.ts", has a
modification time of 17:15. The last application file lands before 18:45. Roughly
ninety minutes of wall clock for the application, plus the documentation you are
reading.

I am telling you that precisely because the number is the point, and because an
imprecise version of it would be a worse claim. **I did not type 26,000 lines in
ninety minutes.** I wrote a build contract ("CONTRACTS.md" in the root), decomposed
the system into non-overlapping file ownership, defined the shared interfaces up
front so that parallel work could not collide, fixed the metric vocabulary and
the design language before anyone wrote a line, and then ran a set of coding
agents in parallel against it. Then I read the output.

That is the actual skill being demonstrated and it is worth naming plainly. In
2026 the constraint on shipping software is not typing speed. It is whether you
can specify a system precisely enough that parallel work converges, and whether
you can tell good output from plausible output when it comes back. The contract
document is the artifact I would point at, not the line count.

### What is in it

The current checkout has nine platform adapters behind one interface (Facebook,
Instagram, X, YouTube, TikTok, LinkedIn, Threads, Reddit and Bluesky). RSS is
retired. An idempotent ingestion runner chunks writes under the Postgres
bind-parameter limit, isolates failures per channel, preserves paid Bright Data
receipts without cross-vendor failover, and records every run with its source
outcome and API call count. A Postgres schema built around the distinction
between audience as a stock and post engagement as a flow. A metric layer that
every read in the product goes through, with the dictionary and its caveats
rendered in the UI. Cross-channel and per-platform overviews, leaderboards, a
post explorer with per-account outlier scoring, rule-based and AI post tagging,
posted-URL analysis, custom dashboards with share links, and seven kinds of alert.
Six working model providers including Ollama. AES-256-GCM encryption for every
stored credential. Three cron jobs with constant-time bearer auth that fails
closed.

And the part I care most about: an AI brief that computes its numbers in SQL,
hands the model a fact sheet it can only narrate, verifies every printed number
against that sheet with 342 lines of deterministic string and number handling and
no second model call, allows exactly one repair turn, and then stores the
markdown, the fact sheet and the verdict in the same row so the document is
auditable a year later.

### What is not in it

No tests. Zero test files. TypeScript strict catches a large class of problems and
does not catch a wrong aggregation. The metric layer is exactly the part that most
needs tests and does not have them, and retrofitting them is about a week.

No production data. It has never run against a real Globe account. The seed
creates the shape of the workspace and deliberately creates zero metrics, because
a seeded number that looks real is a number somebody eventually puts in a deck.

At the original July snapshot, purchased competitor paths had not been wired.
They are now: existing Facebook uses Bright Data; configured TikTok uses Bright
Data with EnsembleData only when Bright is absent; and LinkedIn uses Bright Data
company and company-post datasets. LinkedIn exposes followers, posts, likes and
comments only, and every history window remains source-limited.

---

## 4. What this demonstrates about how I work

**I ship instead of writing decks about shipping.** This document exists because
the software exists, and in that order. I would rather be evaluated on an artifact
somebody can run than on a strategy I can describe. That preference does not go
away at the executive level, it just changes what the artifact is.

**I do build-versus-buy honestly, including when the answer goes against me.**
"docs/BUILD-VS-BUY.md" concludes that on total cost of ownership, buying Rival IQ
is three to five times cheaper than maintaining this, once engineering time is
priced at what it actually costs. That is in a document I wrote to make the case
for the thing I built. I included it because a CTO who cannot argue the other side
is a CTO whose recommendations you cannot calibrate. The case for building rests
on four capabilities a vendor structurally cannot sell, and it is a real case, and
it is not a cost case.

**I deploy AI with guardrails rather than as decoration.** Almost every analytics
product shipped an AI summary button in the last two years. Most of them will
confidently print a number that is not in the data, and the vendor's answer is a
disclaimer. My answer is architecture: the model cannot compute, every number it
prints must trace to a path in a pre-computed fact sheet, a deterministic checker
verifies it before a human sees it, and when the check fails the failure is on the
face of the document. Percent changes over 1000 percent are never printed, because
they are always a near-zero baseline and printing one turns a rounding artefact
into a headline. That rule is enforced in code, in "src/lib/ai/verify.ts", not in
a style guide.

**I treat vendor lock-in as a design question.** Bring-your-own-model is the
biggest differentiator in the product and it exists because I do not think a
newsroom should have to accept somebody else's model choice, somebody else's data
handling, and somebody else's markup as a bundle. Six providers work, including
Ollama for material that should never leave the building. Switching models is a
text field. When a better model ships on a Tuesday, you switch on Tuesday.

**I write down what a system cannot do, in the system.** Every adapter carries
accessNotes that render in the UI. Pooled collection uses an explicit deployment
public-source allowlist, so a workspace owner credential cannot silently supply
a competitor chart. Source-limited histories remain visibly incomplete. Views
of 0 means "not exposed", never "nobody saw it", and the metrics layer stores
NULL rather than 0 so the distinction survives into every query. Every one of
those is a small decision and together they are the difference between a tool
people trust twice and a tool people trust once.

**I am specific about uncertainty.** "docs/DATA-ACCESS.md" labels its X pricing
figures medium confidence because they come from secondary sources rather than
X's own portal, and tells the reader not to sign anything off that table. The
cost model in "docs/BYO-MODEL.md" flags that its 30 percent repair rate is a guess
and says exactly which table to measure it from. That habit costs nothing and is
the entire basis on which anyone should believe the numbers that are not flagged.

---

## 5. The first ninety days

This is what I would do to turn an afternoon's artifact into something the
organisation depends on. It is deliberately unambitious in scope and specific in
outcome, because the failure mode for an internal platform is a broad launch
nobody adopts.

### Days 1 to 30: make it real and make it small

**Deploy it and start the clock.** Bluesky needs no credential and YouTube needs
a free official API key. RSS is retired. Purchased paths require an explicit
Legal/procurement decision and spend controls before collection. The reason for
urgency is that history cannot be bought retroactively, and every week of delay
is a week of comparison data that will not exist next year.

**Start the approvals that take weeks.** Meta App Review for owned Pages and
Instagram Business, and the LinkedIn Marketing Developer Platform application.
Both take weeks, both can be refused, and neither blocks anything else. Start them
on day two and forget about them.

**Pick the landscape with a person, on the record.** Landscape membership changes
share of voice and share of engagement for everybody in it. The audience team
decides who the Globe's real competitive set is, in a meeting, with their name on
it. This is a judgement call and it should not be made by whoever set up the seed.

**Retrofit the tests.** A week of work over the metric queries, the verifier, and
the adapter normalisers. Before, not after, anyone makes a decision on a Data Dumpster
number they would not make on a spreadsheet.

**Buy Rival IQ Drive for one quarter.** 239 a month, 717 total. It buys the
history and benchmark panels this cannot produce, a running check on whether my
numbers agree with a commercial tool's, and a fallback if the build stalls. I am
recommending buying a competitor's product in my own pitch because it is the right
call and because a quarter of parallel running is how you replace an opinion with
evidence.

**Ship the weekly brief to exactly one person.** The audience development lead.
Not a launch, not an announcement. One reader, every Monday, with a standing
instruction to tell me every time a number looks wrong.

**Day 30 test:** four briefs generated, all four read, every disputed number
traced to its fact sheet path within a minute.

### Days 31 to 60: earn the second reader

**Make the refresh window a per-platform setting.** It is the largest cost dial in
the system and it is a constant in a file today. This is the first thing to fix
before anything runs against a metered API.

**Turn on alerts for the social team, tuned hard.** The metric to watch is
acknowledgement rate. If people stop acknowledging alerts, the alerts are wrong,
and an ignored alert channel is worse than none because it teaches people that
Data Dumpster is noise.

**Measure the AI tagger before trusting it.** Two hundred Globe posts, hand
checked, precision and recall written down. It carries evidence and confidence by
design; nobody has verified that the design works on this content. If it is not
good enough, say so and leave rule-based tagging on.

**Roll out Reddit.** New collection tracks publisher-user submissions through
EnsembleData and maps score, comments and crossposts without inventing user
audience. Retained legacy subreddit rows remain readable, but communities are
not new sources. Confirm commercial-use coverage with Legal, then attach the
newsroom accounts and measure cost.

**Day 60 test:** six of eight social team members active weekly, alert
acknowledgement above 50 percent, and at least one publishing decision that
changed because of something in the tool. That last one gets logged by hand, in a
shared document, by the audience lead. There is no instrumentation for it and
inventing a proxy would be exactly the dishonesty this product exists to avoid.

### Days 61 to 90: prove the wedge

**Join posted URLs to first-party data.** Take the URL table, join it against the
Globe's own analytics and subscription events, and answer one question end to end:
for one month, which social distribution produced registrations and
subscriptions. Narrow, one brand, one month. This is the thing that decides
whether any of this was worth doing.

**Desk-level scorecards.** Tags map to desks. Rolling them into a per-desk view is
a query and a screen, and it is the version an editor cares about more than any
competitive leaderboard.

**Write the build-versus-buy decision, with the quarter's evidence in it.** Then
act on it. If people used Rival IQ and nobody missed the governance story, cancel
the build and expand the licence. That is a good outcome, it cost 717 dollars to
learn, and I would say so in the memo.

**Day 90 test:** a written recommendation with data behind it, and one end-to-end
answer connecting social distribution to a subscription outcome. If both exist,
this stops being a competitive tool and starts being the first layer of an
audience data platform. If neither exists, I got the thesis wrong and the memo
says that.

---

## 6. What I would want from the role

**Scope over title.** CTO or CPO matters less to me than whether product,
engineering and data report into one place. The failure mode I have seen most
often in this industry is a product organisation that specifies, an engineering
organisation that estimates, and a data team that reports on it afterwards, with
nobody accountable for whether the thing worked. I want the accountability and I
want the levers that go with it.

**A mandate to build the audience data layer.** Not as a project with a budget
line, as a standing capability. The competitive tool is the wedge. The thing worth
building is the join between what the newsroom publishes, how it is distributed,
and who becomes a subscriber.

**Permission to buy.** I want to be trusted to buy things, including things that
compete with what my own team could build. A CTO who builds everything is as
expensive a mistake as one who buys everything, and the only way to be credible
on the second decision is to have made the first one honestly.

**A small number of engineers who like reading code.** Output in 2026 comes from
specifying precisely and reviewing rigorously. That works with a small team
of strong people and it does not work with a large team of people executing
tickets. I would rather have four than twelve.

**Editorial partnership, not editorial permission.** The metric dictionary lives
in code, which is right for consistency and wrong for ownership. At some point a
person in the newsroom needs to be the one who approves a change to what
"engagement" means. I want that person to exist and I want to be in the room when
they decide.

---

## 7. The hardest objections, answered straight

**"You cloned a 559-dollar-a-month product. Why should that impress us?"**

The clone is not the point and I would not lead with it. The point is that the
clone is a vehicle for three arguments that are hard to make in the abstract:
that AI can be deployed with mechanical guardrails instead of disclaimers, that
model choice should belong to the newsroom, and that a measurement tool that will
not show its work is worse than no tool. Those arguments are much more convincing
attached to running software than attached to a slide. If the response is that
Globe Media should just buy Rival IQ, I wrote that case too, and it is a good one.

**"AI wrote this. What did you actually do?"**

I wrote the contract, decomposed the system, fixed the interfaces and the metric
vocabulary before parallel work started, and reviewed everything that came back.
The interesting evidence is not the code, it is "CONTRACTS.md" and the fact that
183 files written in parallel typecheck clean against each other under strict
mode. That does not happen by accident and it does not happen from a vague prompt.
This is also, candidly, how I think engineering leadership works now, and a
leader who has not personally run a fleet of agents at a real system is going to
be making staffing decisions from theory.

**"There are no tests. This is not production code."**

Correct, and I said so before you did. It is production-shaped, not
production-hardened. The gap is about a week, it is the first item in my day-30
plan, and I would not put a Data Dumpster number in front of the masthead until it is
closed. What the artifact demonstrates is judgement about architecture, honesty
and product decisions. It does not demonstrate operational maturity, and I would
not claim it does.

**"Facebook, TikTok and LinkedIn official APIs do not give you the competitor
product you need. Is half the product missing?"**

No, but the distinction between official and purchased data is load-bearing.
Facebook has an approval-gated sanctioned route through Page Public Content
Access; existing pooled profiles currently use Bright Data. TikTok uses Bright
Data when configured and EnsembleData only when Bright is absent. LinkedIn uses
Bright Data company and company-post datasets, limited to followers, posts,
likes and comments, with no certified historical exhaustion. These paths are
implemented, not automatically authorized: Legal and procurement must approve
them, provenance and coverage stay visible, and a paid Bright Data stage never
falls through to a second vendor after it starts or fails. If a path is not
approved, the honest result is a labelled gap rather than an owner token or zero.

**"Rival IQ has a decade of history. You have zero."**

True, unfixable, and the strongest argument against building. A decade of stored
competitor time series, including CrowdTangle-era Facebook data that exists
nowhere else, cannot be reconstructed. My honest read is that newsroom decisions
depend on 90-day comparisons far more than 24-month ones, but I have not tested
that and if I am wrong it is a real argument for buying. That is why my
recommendation is to run both for a quarter, and why the one thing I would do in
week one regardless is start the clock, because that is the only asset here that
gets more expensive to acquire every day you wait.

**"A CTO should not be writing code."**

A CTO should not be on the critical path of a sprint. A CTO who cannot read a
schema and tell you why it is wrong is making architecture decisions from
briefings. I built this in an afternoon specifically because it does not require
being on anyone's critical path. If it had taken me three weeks it would have
been evidence against me.

**"How do we know an AI brief will not embarrass us in front of the publisher?"**

Because the model cannot produce a number that is not in the data, and if it does,
the document says so on its own face before anyone reads it. The numbers come from
SQL. The model narrates and may not compute. A deterministic checker matches every
printed figure against an index of every number in the fact sheet, with a
tolerance derived from how precisely the number was written, and separately flags
uncited figures, miscited paths, dropped caveats, and any printed percent change
above 1000 percent. One repair turn, then the verdict ships with the document. The
fact sheet is stored alongside it forever. When somebody challenges a number in a
meeting, the answer is a path, in about forty seconds.

**"Who maintains this while you are doing the CTO job?"**

Nobody, and that is the correct answer to the question as asked. An internal tool
with no named owner degrades silently and people keep trusting numbers that
stopped updating in March. If this becomes real it gets an owner who is not me. If
it cannot get an owner, the recommendation in "docs/BUILD-VS-BUY.md" is to buy the
vendor product, and I mean it.

**"Are you a product person or an engineering person?"**

I do not think the distinction survives contact with this kind of work. Somebody
had to decide that engagement rate by follower is the only fair headline metric,
that estimated impressions would never ship, and that a failed verification is
shown rather than hidden. Those are product decisions with no engineering content.
Somebody also had to decide that audience is stored as a daily stock and post
engagement as an append-only flow, that the Neon HTTP driver's lack of
transactions forces ordering plus upserts instead of rollback, and that Server
Components read the query layer directly. Those are engineering decisions with no
product content. The reason the product is coherent is that the same person made
both sets, in the same afternoon, with each informing the other.

---

## 8. Where to look

If you read one file, read "src/lib/ai/verify.ts". It is the clearest statement of
what I think an analytics product owes its reader.

If you read two, add "CONTRACTS.md", which is how the thing got built.

If you want to argue with me, read "docs/BUILD-VS-BUY.md" section 6, which is
where I make the case against myself.

Everything else is indexed in the README.
