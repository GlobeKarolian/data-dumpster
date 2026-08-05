# Data Dumpster: anticipated objections, newsroom and marketing

**What this is.** Matt's own preparation material, written for Matt. Every objection
below is inferred from working notes, product docs and code in this repo. Nothing
here is a quote, a position, or a statement by any actual person at Boston Globe
Media. Nobody said these things. They are the questions the work invites, sorted by
the function that would ask them, so the answers exist before the room does.

**Scope.** Data Dumpster at https://pressbox-kappa.vercel.app. Ninety-day window.
Bluesky and RSS ingest only. RSS carries no engagement, so every engagement number
in this document is a Bluesky number. 1,429 posts across five companies, roughly
sixteen posts a day across the whole landscape.

**Historical scope note, 4 August 2026.** The paragraph above describes the v1
dataset used for this simulated objection exercise, not current ingestion. RSS is
now retired, and the live product has additional official and purchased sources.
Use `HANDOFF.md` for current routing; keep the figures below as a dated Bluesky-only
case study.

Engagement total, 90 days: WBUR 5,739. Boston Globe 5,182. GBH News 1,054.
Boston.com 127. Boston Herald 48. Landscape total 12,150.
Engagement rate by follower, rank order: GBH News, WBUR, Boston.com, Boston Herald,
The Boston Globe.
Top post: a Globe Bluesky post about a cycling advocate, 613 engagements, 38 times
the account median.

One derived number worth carrying in your head. If 613 is 38 times the median, the
Globe's median Bluesky post earns about sixteen engagements. And 613 is larger than
the 557-engagement gap between WBUR and the Globe. One post is bigger than the gap
that produces the headline.

**A note on marketing ownership.** The notes do not identify a Chief Marketing
Officer. There is no CMO in the org file, the People directory, or any meeting note.
What the notes do show is a marketing function split across at least four places:
Adam Bagni as Director of Communications, joined April 2026, announced to the exec
team by Michelle Micone. Sandra Tarnell running brand marketing and creative review,
including the 250th marketing plan and the vertical marketing plans. Shannon Rose
listed under Marketing with no further detail. Carolyn Freeman running paid social,
Keywee subscriber acquisition and the per-desk campaign budgets from inside your own
Platforms team. Thomas Brown owning the subscription and audience math. Part Two is
therefore written by function, not by name. Do not walk into a room assuming one
person owns the marketing answer. Four people own quarters of it, and one of them
reports to you.

---

# PART ONE: NEWSROOM EDITORIAL

## 1. The core objection: does this push editors to chase engagement

This is the real objection and it is partly correct. Do not argue it away. Concede
the three places it lands, then say what you are doing about each.

**Where it is right, first.** Nothing in the metric dictionary measures journalism.
Read definitions.ts. Seventeen metrics, all of them reactions, reach, or ratios of
reactions to reach. Applause, conversation, amplification, saves, views, share of
voice, share of engagement. There is no axis for accuracy, importance, difficulty,
or public service. A tool that measures only reaction, distributed weekly, ranked,
will over time make reaction feel like the thing. That is not a flaw in the code. It
is what the category is.

**Where it is right, second.** The outlier score rewards the outlier by construction.
It is a post's engagement divided by that account's own in-window median. The top
result in ninety days is a cycling advocate post at 38 times median. If that becomes
the internal picture of a good post, you get more posts shaped like it and fewer
stories that matter and do not travel. The metric cannot tell you which of those two
happened.

**Where it is right, third.** An AI-written weekly document arrives with more
authority than a person saying the same thing, and it arrives every week whether or
not anything happened. Repetition is a form of pressure. A brief that says the Globe
is last on engagement rate, forty times a year, is an argument being made forty times
whether anyone intended to make it.

**Now the honest answer.**

The comparison already happens. It happens today in Rival IQ, and it happens badly,
because the numbers that are easiest to pull are total engagement and follower count.
Both scale directly with audience size. A national outlet beats a metro daily on both
regardless of whether the content is any good. The choice in front of the newsroom is
not measure versus do not measure. It is measure with a fair denominator and stated
caveats, or keep making the same comparison on numbers that are structurally rigged.

The primary user in the PRD is not an executive with a ranking. It is a social editor
with a defensive question: engagement dropped eighteen percent, was that us or was
that the platform. Those two situations call for opposite responses and both are
expensive if you guess wrong. That is an anti-panic instrument, not a chase
instrument. Lead with that framing and it survives the room.

**What you should commit to, out loud, before anyone asks.**

- No ranked leaderboard in anyone's inbox. Distribute the outlier feed and the
  posted-URL view. Keep the leaderboard behind a click, for the audience lead.
- The metric dictionary gets a newsroom owner. Your own PRD flags this as an open
  question: definitions live in code, which is right for consistency and wrong for
  editorial ownership. Name a newsroom person who approves any change to what
  engagement means. Do it before the first brief circulates, not after.
- The competitive set gets a newsroom owner too. Share of voice and share of
  engagement move when the landscape changes, without anyone changing behaviour. Who
  is in the landscape is an editorial judgement. Put it on the record.
- Nothing in Data Dumpster feeds a performance review. Say it in writing. If you do not
  say it, people will assume the opposite, and they will be assuming it about a tool
  built by the team they already believe is grading them.

## 2. The one load-bearing assumption an editor will find

Expect the same style of scrutiny that produced the questions about The Brief. Not a
philosophical objection. A practical one, about business logic, asked in one
sentence, that you either have an answer to or you do not.

The question is this. **Does the Globe being last on engagement rate mean anything,
given that the metric divides by the number of posts?**

Engagement rate by follower is defined as total engagement, divided by followers,
divided by posts, computed per platform and then combined. Post volume sits in the
denominator. An account that posts every headline is mathematically penalised against
an account that posts selectively, at identical content quality. The Globe's Bluesky
account behaves like a distribution feed. A public radio account behaves like a
curated presence. That difference alone can produce this exact ranking with no
difference in the journalism at all.

The tooltip in your own code already concedes half of this. It says the metric "can
flatter very small accounts whose handful of loyal followers all engage." GBH News is
first on rate and produced 1,054 engagements over ninety days. That caveat is not
hypothetical here. It is describing the finding.

**Your answer.** Say the assumption plainly rather than being caught holding it.
Engagement rate by follower is the fairest cross-company metric available, and it is
still not a content quality score. It is a per-post efficiency score, and efficiency
is not what a paper of record is optimising for. The Globe's Bluesky account is doing
a different job than GBH's and should be judged against its own baseline, which is
what the outlier score does. Then offer the fix: report the Globe against the Globe,
week over week, and use the cross-company rate only when the volumes are comparable.

The second-order version of the same question, which is the one an editor who has
been through a paywall conversation will ask: **does any of this convert?** The
answer is no, and the answer has to be no out loud. Data Dumpster has no attribution. It
never touches a subscription start. Consumer revenue is the business. Bluesky
reactions are not a leading indicator of it and nothing in this system claims they
are. If you let anyone believe otherwise for one meeting, you will spend a quarter
walking it back.

## 3. Boston.com versus the Globe on one leaderboard

Boston.com sits fourth of five on engagement rate and produced 127 engagements over
ninety days. That is about 1.4 engagements a day. It is not a measurement. Any rank
built on it is noise, and the Herald at 48 is worse. Ranks three, four and five in
this dataset should be treated as unranked.

But the sample size is the smaller problem. The larger one is that the two brands are
in different businesses, and a shared leaderboard implies they are not.

The Globe is a metered, paid, consumer-revenue product. Boston.com is the free front
door. Its own strategy work describes it as the product for people who will never pay
for the Globe, sponsorship-first, no paywall, ever. Its social channel is doing
reach and referral work, not conversion work. Kaitlyn Johnston's referral strategy
runs through NextDoor, Teads and Yahoo, none of which Data Dumpster can see. Ranking those
two brands in one column produces a number whose only actionable reading is that
Boston.com should behave more like the Globe. The brand strategy explicitly rejects
that. The leaderboard would be quietly arguing against the plan.

**What to do about it.**

- Split the landscapes. The seed already ships two. Give Boston.com its own, with its
  own competitive set, which is probably not WBUR and GBH at all. Whatever else
  competes for free Boston reach belongs in it.
- Suppress ranks below a minimum sample. A company with under, say, 500 engagements
  in-window gets a labelled gap, not a rank. This is the same discipline the product
  already applies to Facebook and TikTok. Apply it to thin samples too.
- If you must show both brands together, show share of engagement with the two summed
  as a portfolio line. Globe plus Boston.com is 5,309 of 12,150, or roughly
  forty-four percent of the landscape. That is a true sentence and a more useful one
  than either brand's rank.
- Multi-brand rollup is already on the Later list in the PRD and the schema supports
  it. Say that. It reads better as a known next step than as an oversight.

## 4. AI briefs in editors' inboxes: who is accountable when one is wrong

This is the section where overselling kills you. Be precise about what verify.ts
proves, because the newsroom will read it more carefully than anyone else in the
building, and one overstatement here costs you the whole product.

**What the verifier actually does.** It is 342 lines with no model call in it. It
splits the brief into sentences on the original text. It strips everything containing
digits that is not a quantitative claim: citations, markdown links, code, ISO dates,
bare years, clock times, and calendar dates in prose. It extracts every remaining
number as people write them, including 1.2M, 45k, 27.3 percent and 2.3 million. It
derives a tolerance from written precision, so 1.2M is allowed to be 1,234,567 and is
not allowed to be 900,000. It matches each number against an index of every number in
the fact sheet, built by walking the object. It reports three failure classes
separately: unverified, meaning the number is nowhere in the sheet; miscited, meaning
the number is real but the bracketed path points somewhere else; and violations,
meaning an uncited figure, a printed percent change above 1000 percent, or a dropped
caveat. It checks caveat coverage by distinctive-word overlap at a sixty percent
threshold. It never throws. The verdict is stored with the fact sheet and the
markdown, so the document is auditable a year later.

That is a real mechanism and it is more than most vendors have. Now the limits.

**What it does not prove. State every one of these before an editor finds them.**

- **It checks values, not meaning.** A number matches if it appears anywhere in the
  fact sheet within tolerance. The matcher returns the first entry that fits. A
  sentence that says WBUR led with 5,182 would pass verification, because 5,182 is in
  the sheet. It belongs to the Globe. Attributing the right number to the wrong
  company is invisible to this checker.
- **Sentences without numbers are not checked at all.** The What to watch section,
  the descriptions of what a post actually was, the causal framing in the headline.
  That is where the editorial risk lives and it receives zero verification.
- **It cannot check the fact sheet.** Verification compares prose to SQL output. If
  ingestion missed posts, if a channel stopped syncing, if a metric is defined wrong,
  the brief passes with full confidence and is wrong from the foundation up. A green
  badge means the model narrated the sheet faithfully. It says nothing about whether
  the sheet is right.
- **Caveat coverage is word overlap, not semantics.** Sixty percent of the
  distinctive words present counts as covered. A sentence can reuse the vocabulary of
  a caveat while reversing its sense and still pass.
- **Dates are deliberately stripped, so a wrong date range is never caught.**
- **Tolerance permits real error.** Half a unit in the last written place. A number
  written to one significant figure can be several percent off and still verify.
- **The badge overstates itself to a casual reader.** The briefs list renders "N
  claims verified" in a green pill. Most people will read that as "this brief is
  verified." Those are different statements. Change the label before this ships to
  anyone. "N of N figures traced to source" is honest. The current one is not, quite.

**Who is accountable.** Right now, nobody, and that is the actual gap. There is a
Generate button and a document. There is no approval step, no named signer, no
editorial queue between generation and reading. If briefs land in editors' inboxes as
built, the accountable party is whoever pressed send, and the tool does not record
who that was in a way anyone would look at.

Fix it before the demo, not after the question. One named human signs every brief
before it circulates, the same way a wire summary gets a byline or an initial. This
also lines up with where the newsroom already is on AI-generated content: editorial
oversight, reporter control, human sign-off. You are not conceding anything by
offering it. You are matching the standard the newsroom has already set for
everything else, and you get to say so first.

## 5. The political dimension: does this help or hurt

Honest read: **as currently framed, it hurts.** A tool built by Platforms that ranks
the newsroom's social output, with the Globe last, distributed by Platforms, lands
inside an existing argument about SEO reporting lines, headcount, and who gets credit.
It will be read as Platforms grading the newsroom, because a leaderboard is a grade,
and because the surrounding history gives that reading somewhere to land.

The timing makes it worse. There is a live cannibalization argument about a different
Platforms-built product. There is an unresolved question about paywall behaviour on
links out of that product. There is a McGrory meeting on the calendar for tomorrow
that exists to settle it. **Do not put Data Dumpster anywhere near that meeting.** One
Platforms product under scrutiny is a conversation. Two is a pattern, and the pattern
becomes the story.

**What actually helps, in order.**

- **Lead with the concession you have already made.** You went on record in writing
  that you are fully supportive of the SEO editor role, or whatever replaces it,
  remaining in the newsroom under Jason's team. That is the most valuable sentence
  you own right now. It proves the position is not territorial. Say it before you
  open the tool, not as a defence afterwards.
- **Do not present the leaderboard.** Open on Social Posts with the outlier score and
  on Posted URLs. Both are service. Neither is a grade.
- **Give it away structurally, not rhetorically.** The newsroom owns the landscape,
  the newsroom owns the metric dictionary, the newsroom names the person who signs
  the brief. Three concrete transfers of control, all of which your own PRD already
  lists as unowned open questions. You lose nothing you currently have.
- **Do not demo it yourself the second time.** First conversation is you, one to one,
  with Jason Tuohey and Vicki McGrane, small room, no deck. Second conversation, they
  drive it. A tool the newsroom demonstrates is a newsroom tool.
- **Frame it as replacing a vendor, not adding a judgement.** This is an internal
  replacement for Rival IQ, which the newsroom already uses. That framing changes the
  question from why is Platforms measuring us to why are we paying for the worse
  version of this. It also lets you name a real governance win: one fewer external
  vendor holding credentials to Globe social accounts.
- **Never let the word grade near it.** Talk about baselines and breakouts. Not ranks.

## 6. The one thing an editor would genuinely find useful

Not the leaderboard. Not the brief. The outlier score on Social Posts.

Concretely. A social editor opens Data Dumpster at nine in the morning and sees, in one
filterable table, every post from every competitor in the landscape scored against
that competitor's own median for that platform in that window. A 4.0 means the post
did four times what that account normally does. The Globe's cycling advocate post
scored 38.

That is the useful thing, for one reason: it is the only number in the product that
does not compare the Globe to anyone else. It compares each account to itself. So it
answers the question an editor actually has at nine in the morning, which is not
"where do we rank," it is "did something break out overnight that we should be on."
When a competitor's post is running thirty times their median about a story you have
not staffed, that is a real editorial signal available within the hour, and today it
requires a person screenshotting accounts into a spreadsheet.

Pair it with Posted URLs, which shows what a competitor is actually driving traffic
to, grouped by domain or by URL. Together they answer what a competitor is pushing
and what is landing. That is a morning tool. Lead the newsroom conversation with
those two screens and nothing else.

---

# PART TWO: MARKETING AND BRAND

Written by function. The notes do not name a Chief Marketing Officer. Communications
sits with a Director of Communications who joined in April 2026 and reports up
through the same leadership as Innovation. Brand marketing and creative review sit
with a separate person who runs the marketing plan sheets and the creative review
meetings. Paid social and subscriber acquisition sit inside your own team. The
subscription math sits with the person who owns the 260K and 313K numbers. Assume all
four are in the room, or that the person in the room has to carry all four positions.

## 1. Positioning against WBUR and GBH, who are not in our business

WBUR is first on total engagement at 5,739 to the Globe's 5,182. GBH News is first on
engagement rate by follower. Both are nonprofits. Both are member-supported. Neither
has a meter.

**What losing to them on engagement actually means, mechanically.** A public media
post links to a free page. Every click completes. Sharing costs the sharer nothing
and costs the recipient nothing. A Globe post links to a metered page. Some share of
clicks hits a wall, and people share less when they know the destination is walled.
That is a structural difference in the conversion path, not a difference in the
journalism. You should expect a free product to out-engage a paid product on a
sharing-driven platform, and the fact that the Globe is within eleven percent of WBUR
on total engagement is arguably the more interesting number in the dataset.

**Is it even the right comparison.** For editorial competition, yes. WBUR and GBH
compete with the Globe for regional attention and regional authority, and being
out-shared in your own market is a real signal about salience.

For business competition, no. Their definition of success is reach, membership, and a
story a funder or an underwriter believes. The Globe's is 260K direct credit-card
subscribers and 313K total digital. WBUR and GBH are not on the Press Gazette list of
English-language digital publishers above 100K subscribers because they are not in
that business. The Globe's actual peer set on the thing the Globe gets paid for is
the LA Times at 243K, the Chicago Tribune at 152K, SF Chronicle at 138K, the
Philadelphia Inquirer at 117K, the Star Tribune at 102K and the AJC at 100K. The
Globe is 36th globally.

**The line to have ready.** WBUR and GBH beat us on Bluesky engagement and we beat
our actual peer set on the number that pays for the newsroom. Both are true. They are
answers to different questions and neither substitutes for the other. Refuse to
merge them.

## 2. Is the engagement rate finding real, or a Bluesky artifact

Be rigorous here, because a marketing leader will either dismiss this too fast or
believe it too much, and both are expensive.

**The finding is fragile. Six reasons, in order of severity.**

1. **One platform in this v1 sample.** Only Bluesky contributed engagement to the
   dated sample. Facebook and Instagram, where the Globe's largest audiences
   almost certainly live, contributed nothing to these figures. That was a
   collection-state limitation, not market impossibility: Facebook competitor
   data is available through PPCA after approval and through purchased sources,
   while current Instagram collection also has purchased paths. This is not a
   social performance picture. It is one text-platform case study.
2. **Bluesky is unrepresentative in a way that points directly at this result.** Its
   user base skews toward journalists, academics, and politically engaged early
   Twitter migrants. Public media brands index unusually well with exactly that
   population. GBH leading on engagement rate is at least partly a platform-audience
   fit result, and no amount of data from this one platform can separate that from a
   content quality result.
3. **The metric divides by post volume.** Engagement, over followers, over posts. An
   account that publishes selectively beats an account that publishes constantly at
   identical quality. See Part One, section two. This is the single most likely
   explanation for the Globe's position and it has nothing to do with content.
4. **Two of the five samples are not measurements.** Boston.com produced 127
   engagements in ninety days. The Herald produced 48. Ranks three, four and five are
   noise and should not appear in any document.
5. **One post is bigger than the gap.** The top Globe post scored 613 engagements,
   which is about twelve percent of the Globe's ninety-day total and more than the
   557-engagement gap between the Globe and WBUR. Remove one or two outlier posts
   from either account and the total-engagement ranking flips. There is no
   significance testing anywhere in the leaderboard path. The anomaly detector
   computes z-scores; the leaderboard does not.
6. **There are no impressions, anywhere.** Engagement rate by view is undefined for
   essentially every competitor on every platform, because no public API exposes
   impressions for content you do not own. Data Dumpster correctly stores NULL rather than
   zero. But it means the system cannot distinguish "fewer people saw it" from
   "people saw it and did not react." That distinction is the entire question a
   marketing leader is asking, and this tool cannot answer it.

**Honest verdict to give.** The finding is directionally interesting and not
decision-grade. It is worth one sentence of curiosity and zero sentences of strategy.
If you want it to be decision-grade, you need a second platform ingesting, a minimum
sample floor, and a look at whether the rank survives removing the top five posts from
each account. That last test takes an afternoon and it is the one that would settle
it.

## 3. What Data Dumpster does not measure that marketing is accountable for

Name this gap yourself, completely, in one breath. If a brand leader assembles this
list on their own during the demo, you have lost the room. Most of these are
deliberate non-goals in the PRD, which is a defensible position, but only if you say
so first.

- **Paid social. Not measured, ever.** Explicit non-goal. Facebook Ads reporting is a
  genuine Rival IQ feature that Data Dumpster will not have. The Keywee subscriber
  acquisition campaigns and the per-desk paid budgets run out of your own team are
  invisible to this tool. If the Globe needs paid social reporting, that is an
  argument for keeping a vendor, and your own build-versus-buy doc says so.
- **Campaign attribution. Not measured.** Nothing connects a post to a click to a
  session to a subscription start. Posted URLs shows what a competitor links to. It
  does not show what converted, for them or for us.
- **Subscription conversion. Not measured.** Data Dumpster and the 260K and 313K numbers
  never touch. There is no path in the schema between an engagement and a revenue
  event, and building one is a different product.
- **Brand sentiment. Not measured, by design.** Explicit non-goal: this is not social
  listening. Conversation is a comment count with no sentiment attached, and the
  tooltip says so directly: a comment surge can mean a story struck a nerve rather
  than that it landed well.
- **Share of voice in coverage. Not measured.** The metric named share of voice is
  share of posts inside a landscape you chose. It moves when you add or remove a
  competitor, without anyone changing behaviour. It says nothing about whether the
  Globe owned a story, broke it, or got cited on it. Do not let that metric name do
  work it cannot do in a marketing conversation.
- **Owned-channel performance beyond social.** No newsletter, no app, no site, no
  search, no push. Marketing is accountable for a funnel and this measures one
  organic slice of one stage of it.

Summary line: today Data Dumpster measures organic reactions on one free text platform for
five publishers. That is a slice of a slice. It is a real slice and it is honest
about its edges, which is more than the incumbent, but it is not a marketing
performance system and it should never be introduced as one.

## 4. Data governance and bring-your-own-model

**What reassures.** Data Dumpster ships no inference. The organisation points it at a
model it already controls: an Anthropic key, an Azure deployment, or an Ollama box in
the building with no network egress at all. Model API keys and platform credentials
are encrypted at rest with AES-256-GCM. Every AI call writes a row with org,
connection, feature, tokens, cost, latency and success, so spend is answerable from
the Globe's own database rather than from a vendor invoice. Switching models is a
text field, not a procurement cycle. Nothing hard-codes a model name.

There is also a governance win worth naming out loud, because it is concrete and
unglamorous: replacing Rival IQ removes one external vendor holding credentials to
Globe social accounts. There is already a live credential-notice problem on that
vendor in the notes. That is a real reduction in surface area, and it will land
better with a brand leader than the architecture argument will.

**What it opens up. Expect all five of these.**

1. **Bring your own model answers which model, not which infrastructure.** This runs
   on Vercel against a Neon Postgres database. Where does that database live, who has
   access, what is the retention and backup policy, is it in the vendor register, has
   Legal or IT reviewed it. The model governance story is genuinely strong and it does
   not cover the data store. Have that answer written down before the demo.
2. **The share URL.** Dashboards can be published at an unguessable share URL for
   people who should see one chart and not the whole tool. That is security by
   obscurity. A brand leader will immediately picture a link with the Globe last on a
   leaderboard being forwarded outside the building. It is one paste away. Either put
   authentication on published dashboards, or set a policy that competitive rankings
   are never publishable, before this is shown.
3. **The Ask box is a free text field.** Your own BYO-MODEL doc makes this point
   better than anyone in the room will: people type things into free text fields. The
   risk is that someone types an unpublished plan or an embargoed detail into a query.
   Bring your own model does not eliminate that risk. It points it at an endpoint you
   have already reviewed, which is better, and is not the same as gone.
4. **Today's content is public and tomorrow's may not be.** Right now the model sees
   published posts, ours and competitors'. That is not a governance problem. It
   becomes one the moment tagging touches internal desk taxonomies or a brief
   references unpublished plans, both of which are on the roadmap.
5. **Who administers the keys.** One person configuring model connections and reading
   the spend panel is a single point of both failure and trust. Name the owner and the
   backup.

**Net read for a brand leader.** Reassuring on model governance, genuinely better than
a hosted SaaS on that specific axis, and incomplete on infrastructure governance and
on the share URL. Bring both gaps yourself.

## 5. Is this ready for the senior leadership team

**No. Not yet, and not soon.** Say that first. Presenting it as ready is the fastest
way to lose it, and the product's own documentation is more honest about its state
than a demo would be.

**What would need to be true.**

1. **A second platform ingesting.** One platform is not a competitive picture. YouTube
   needs a free Data API key and minutes of setup and gives full public competitor
   stats. Do that before any leadership conversation. It converts a one-platform
   curiosity into a two-platform read.
2. **A named owner for the landscape and for the metric dictionary.** Both are open
   questions in your own PRD. Do not show a leaderboard whose competitive set nobody
   has signed. The first SLT question will be who chose these five companies.
3. **A sample floor.** Boston.com and the Herald either excluded or labelled as
   insufficient sample. A ranked five-row table where two rows are noise will be
   screenshotted, and the screenshot will outlive the caveat.
4. **A measured verification pass rate on real Globe data.** The thirty percent repair
   rate in the cost model is explicitly labelled a guess in your own doc. Two weeks of
   the usage table replaces it with a number. Walking into SLT with a guess in the
   cost table is an unnecessary risk when the fix is two weeks of running it.
5. **AI tagging precision measured on 200 posts.** Your PRD lists this as an open
   question and it is the right one. No tagged number goes near a deck until it is
   answered.
6. **A build-versus-buy answer with real numbers.** Every SLT member will ask what this
   saves. Have the Rival IQ contract value, the renewal date, and the honest statement
   that Rival IQ has a decade of stored time series including CrowdTangle-era Facebook
   data that cannot be reconstructed and that Data Dumpster starts its clock the day
   ingestion starts.
7. **A share URL policy.**
8. **The manual log started.** Your own success metric that matters is decisions
   changed, target four a quarter. Today it is zero, because it has not been running.
   Four logged instances of a Data Dumpster number changing what got published or promoted
   is a far better SLT story than any chart.

**Sequencing.** Newsroom first, one to one, small. Then marketing, by function. Then a
quarter of real use with the manual log running. Then SLT, with the log as the pitch
and the tool as the evidence. Do not put this in the same SLT slot as any other
Platforms product, and do not put it anywhere near the cannibalization conversation
currently in flight.

---

# WHERE NEWSROOM AND MARKETING WOULD DISAGREE WITH EACH OTHER

You will be in a room with both. These are the three fault lines. On each one, both
sides are partly right, which is what makes them fault lines rather than
misunderstandings.

## Fault line one: which metric is the headline

Marketing needs share of engagement and share of voice. Those are the numbers that go
into a positioning story, a media kit, or an underwriter conversation, and they are
the only numbers in the product that describe the market rather than a single account.

The newsroom needs the outlier score, because it is the only number that changes what
gets published today, and because it compares each account to itself rather than to
anyone else.

The collision: share of voice and share of engagement move whenever the landscape
changes, without anyone changing behaviour. The newsroom will call that gameable and
they will be right. Marketing will answer that every competitive metric in every
industry has that property and they will also be right. Whoever gets to define the
competitive set decides the outcome of the argument, and right now nobody owns that.
Settle ownership before the two functions ever see the same screen.

## Fault line two: whether losing to WBUR and GBH requires a response

Marketing has to have an answer when a competitor's engagement number gets cited by an
advertiser, a peer publisher, or a funder-adjacent conversation. Silence reads as
concession. The instinct will be to move the number.

The newsroom's answer is that WBUR is free and the Globe is paid, that a sharing
platform structurally favours the free product, and that the comparison is not apples
to apples. That is correct.

The collision is not about the facts. It is about whether the number needs a public
response at all. Marketing will want to close the gap. The newsroom will want to
refuse the frame, and will read any effort to close the gap as exactly the engagement
chasing they objected to in the first place. This is the argument where Data Dumpster goes
from a tool to a wedge. Have a position before it starts: the gap gets explained, not
closed, and nothing about publishing changes on the basis of it.

## Fault line three: what an AI brief is for, and what counts as edited

Marketing will want the brief to be clean, shareable and forwardable, and will
eventually want a version that goes to SLT or further. A well-written weekly document
is precisely what a communications function is short of.

The newsroom will want a hard rule that no AI-written document circulates without a
named human signing it. That is consistent with where the newsroom already is on
AI-generated content and with the reporter-control principle applied to everything
else.

The collision lands on one specific object: the Generate button, and the green badge
next to the brief that says the claims were verified. Marketing will read that badge
as a quality assurance and a reason to skip a review step. The newsroom will read any
document that skipped a review step as unedited, regardless of the badge. Both
readings are reasonable and they cannot both govern.

This one is yours to decide before it is decided for you. The defensible position:
the verifier checks that figures trace to source and nothing more, a named human signs
every brief before any distribution, and the badge gets relabelled so it stops
implying more than it proves.
