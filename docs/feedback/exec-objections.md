# Data Dumpster: anticipating the hard questions

**What this is.** Matt's own preparation material, written for Matt, ahead of
presenting Data Dumpster to the CEO. The questions and objections below are inferred
from Matt's own working notes about how proposals get evaluated at Boston Globe
Media. Nothing here is a quote, a position, or a statement by any actual person.
No one has said any of it. It is a stress test written in advance so the holes
get found here rather than in the room.

Written July 2026. Numbers are from the live system, 90-day window.

---

## 1. The one-paragraph version

Open with this. Say it out loud before you open a browser tab.

> We pay for a tool that tells us how our social accounts compare to other Boston
> newsrooms. It tells us we are behind, and it does not tell us why or what to do
> about it. I built a replacement that answers the second question, and while I was
> testing it against real data it surfaced something I think you need to see: on the
> one platform we can measure cleanly, WBUR gets more total engagement than we do,
> with a smaller newsroom and a smaller following. That is not a tooling finding.
> That is a distribution finding. The tool is how we found it, and the tool is the
> smaller half of what I want to talk about.

Why this opening works:

- The "so what" is in sentence two. The finding leads. The software follows.
- It does not ask for a decision in the first breath. It puts a fact on the table.
- It contains no technical vocabulary. No adapters, no ingestion, no TypeScript,
  no agents, no line counts.
- It gives her something to react to that is about the Globe, not about Matt.

What NOT to open with, in priority order:

1. "I built this in an afternoon." It is the most impressive fact and the worst
   opening line. It makes the meeting about how it was built. It also makes the
   thing sound disposable, which is the opposite of what you need.
2. Line counts, file counts, framework names, model providers.
3. "It's a clone of Rival IQ." That frames the whole conversation as a cost
   argument you lose on the arithmetic. See Q2.
4. A demo. Do not open a browser in the first five minutes. Talk first.

---

## 2. The hard questions

Fifteen. Each one: the question, why it gets asked, and a draft answer you can
actually say. Read the draft answers out loud. If you cannot say one naturally,
it is wrong and you should rewrite it in your own words before the meeting.

---

### Q1. What decision does this change, and who acts differently on Monday?

**Why it gets asked.** This is the standing test for anything that is not
obviously revenue. A tool that produces awareness and no behavior change is a
subscription with extra steps. It is also the question that separates a deployed
solution from an experiment, which is the bar you have been told to clear.

**Draft answer.**

"Three people, three different decisions.

The social editor, daily. Right now when a post underperforms they cannot tell
whether their post was bad or the whole market was quiet that day. Data Dumpster
answers that in about ten seconds. That changes what they publish next, and it
changes whether they spend an hour rewriting something that was fine.

Carolyn, weekly. She plans the week without comparative evidence. The tool tells
her which desks and formats actually beat our own baseline, not the industry
average. That changes the calendar.

You and the leadership team, monthly. Right now our social reporting is our own
numbers with no reference point. This puts a peer set next to it, so a flat week
reads as a flat week or a flat market, and you know which.

Here is the honest limit. I can name the decisions. I cannot yet prove any of them
changed, because the tool has been live for a day. The day 90 test I am proposing
is that the audience lead logs, by hand, in a shared doc, at least one publishing
decision that changed because of something in the tool. If that log is empty at 90
days, I got it wrong and I will say so."

**Do not** claim adoption metrics as the success measure. Log the decision, not
the logins.

---

### Q2. Why build this instead of just paying Rival IQ?

**Why it gets asked.** Because it is the obvious question, because it is the
right question, and because your own build-versus-buy document answers it against
you. If she reads that document before the meeting, she arrives with the answer
already formed.

**Get ahead of it. Say the losing number yourself, first.**

**Draft answer.**

"On cost, buying wins, and it is not close. Rival IQ at the configuration we would
actually want is about 609 dollars a month, roughly 7,300 a year. Data Dumpster is
about 250 a month in cash, plus somewhere between a tenth and a seventh of an
engineer to keep it alive, which prices out between 1,900 and 3,400 a month. Buying
is three to five times cheaper. I wrote that down in my own document before anyone
asked me, and I am not going to argue with it.

So the case for building is not a cost case. It is three things a vendor
structurally cannot sell us.

One. Every person at BGM can have a login for zero marginal dollars. Rival IQ
charges per seat. D-Raj has been asking for direct access to data so his team can
check numbers themselves rather than asking mine. A per-seat tool makes that
expensive on purpose. This one makes it free.

Two. The database is ours. That means we can join what we posted, to what got
clicked, to who subscribed. Nobody in this industry answers that well. Rival IQ
sells us a report. This is the first layer of an audience data platform, and the
competitive tool is the by-product.

Three. The AI features run on inference we control, so newsroom content does not
have to leave the building to get summarized.

If none of those three matter to us, then the answer is to write the cheque and I
will say so in the memo."

**Landmine.** Do not let this become a rivalry with a vendor. The framing is
"what does owning the data let us do," not "we can beat a 559 dollar product."

---

### Q3. Who maintains this when you are doing your actual job?

**Why it gets asked.** It is the correct question and it is the one that kills
internal tools. An unowned internal tool does not die loudly. It degrades quietly,
and people keep trusting numbers that stopped updating in March. Your own
build-versus-buy document names "no named owner" as the single decisive condition
for buying instead.

**Draft answer.**

"Nobody, today. That is the honest answer and it is also the reason to buy, per my
own document. So I am not going to pretend the risk away. I am going to make the
ask conditional on removing it.

I am asking for two named people. An operating owner, who reads the weekly output
and owns the question of whether it is right. And a named engineer with a few
hours a month, for the thing that actually breaks, which is platform APIs changing
without notice. Roughly four to eight hours a month steady state. That is a real
number, not a hopeful one.

If we cannot name those two people in the next two weeks, we should not do this. I
would rather stop it on a technicality now than have it rot for a year and have
somebody put a stale number in a board deck. So make that the first tripwire. No
owner by day 14, we keep Rival IQ and I close the repo."

**This is your strongest move in the whole meeting.** Volunteering the kill
condition is what separates "deploy" from "experiment."

---

### Q4. Is this the best use of the Platforms team right now?

**Why it gets asked.** Because it is a resource question wearing a product
question's clothes, and because your team already carries newsletters, SEO, social
operations, CMS, and the AI enablement work. Adding a software product to that
list is not free even if the code is written.

**Draft answer.**

"It is not a use of the Platforms team. That is the point of the shape of the ask.

The build is done and paid for. What I am asking for is a few hours a month of
engineering from Brad's side for maintenance, and about a week, once, to put tests
around the parts that compute numbers. Nobody on my team stops doing anything.

What my team does is read the output. Carolyn already produces a weekly view of
social performance. This changes what goes into it, not who makes it.

And the reason to spend the week now rather than next quarter is that competitive
history cannot be bought retroactively. Every week we wait is a week of comparison
data that will not exist in a year. That is the only part of this with a clock on
it."

---

### Q5. How does this relate to the reporting work already asked for?

**Why it gets asked.** Because there is a live, specific, unfinished request:
the weekly report needs a narrative, every metric needs a "so what," and the naked
tables need to stop. If Data Dumpster arrives before that request is satisfied, it
looks like a new project displacing an assigned one. That is the worst possible
read and it is easy to avoid.

**Draft answer.**

"This is the thing that makes that report possible, and I should have led with
that.

The reason our weekly social report has been numbers without a narrative is that I
had numbers without a reference point. Our engagement was up eight percent. So
what? I could not tell you whether that was us or the market, because I had nothing
to compare against except our own past.

Data Dumpster produces a written brief. Prose first. Every number in it carries the
comparison, against last period and against the peer set. And here is the part I
care about: every number in that brief is checked against the source data by code
before a human reads it, and if a number fails the check the document says so on
its own face.

So this is not a new project. It is the missing input to the report you already
asked for. If we do nothing else with it, I would still want it for that."

**Bring one.** Print a single generated weekly brief. One page. That is the
artifact for this question, not the dashboard.

---

### Q6. What does this actually cost, all in, including the data and the AI?

**Why it gets asked.** Because the free-software claim never survives contact
with the data bill, and because a proposal that prices the servers and calls the
engineering free is a proposal that has been massaged.

**Draft answer, and have these numbers memorized.**

"Cash, per month:

Hosting and database, 40 to 70 dollars. AI inference for the weekly briefs and
tagging, 5 to 15 dollars, because we use our own model agreements rather than
paying a vendor's markup on theirs. Data is the real line: about 175 dollars a
month to cover the platforms we cannot get for free, which is most of them. Call
the cash number 250 a month, budget 300.

Then the part people leave out. Engineering time. Four to eight hours a month of
maintenance, plus feature work if it is a living product. That is a tenth to a
seventh of an engineer, which at fully loaded cost is 1,700 to 3,400 a month. That
is the real cost and it dwarfs the cash.

Total equivalent, 2,000 to 3,400 a month against Rival IQ's 609. I am telling you
the number that argues against me because you should not have to find it."

**If asked about the 175 dollars.** That buys Instagram, TikTok, Facebook,
LinkedIn and X competitor data from a data vendor. Go straight to Q12, do not wait
to be asked.

---

### Q7. Rival IQ has a decade of history. We have zero. What happens to our archive?

**Why it gets asked.** Because it is the single strongest argument against
building, and because canceling a subscription means losing access to years of
stored comparisons including Facebook data from the CrowdTangle era that does not
exist anywhere else at any price.

**Draft answer.**

"It is unfixable and it is the best argument on the other side.

Three practical points.

First, I am not proposing we cancel anything. Keep Rival IQ running through the
whole evaluation. The archive stays available the entire time.

Second, before any cancellation decision ever gets made, we export everything the
contract lets us export and we keep it. That is a task on somebody's list on day
one, not a thought we have in month eleven.

Third, my honest read is that newsroom decisions lean on 90-day comparisons far
more than on 2019 comparisons. But I have not tested that and I am not going to
assert it. So the test is simple: over one quarter, count how many times anybody
actually needs history older than what we have. If the answer is more than zero
and it mattered, that is a real argument for keeping the licence permanently, and
I will make it."

---

### Q8. Does this clear the "stop experimenting, deploy" bar, or is this another experiment?

**Why it gets asked.** Because it is the standing directive, and because "built
in a day, two of six platforms live, zero tests" reads as an experiment on its
face. Assume this question is coming whether or not it is spoken.

**Draft answer.**

"Fair challenge, and I want to answer it directly rather than around it.

Here is why I think it clears the bar. It started from a problem people actually
have, not from a tool I wanted to try. The problem is that our social team makes
forty publishing decisions a day with no comparative evidence, and the report you
get every week has no reference point in it. That problem was in front of me before
any software existed.

It is deployed. It is running against real data right now, not a demo dataset. It
has a named user, a named output, and a weekly cadence.

And it has stop conditions I wrote before you asked for them, in section five of
this plan, with dates on them.

Here is where the challenge lands and I will not dodge it. It has no tests, and
two of six platforms are live. So I am not asking you to bet anything on its
numbers yet. I am asking for one week of engineering to close the test gap and
about 175 dollars a month to close the platform gap, and then it is deployed
software with an owner. If we cannot get those two things, the answer is to keep
Rival IQ, and that is a fine answer."

**Word discipline.** Do not say pilot. Do not say experiment. Do not say
efficiency. Say deploy, owner, stop conditions, capacity.

---

### Q9. The tool says we are last. Are we last?

This is section 3. Do not answer it in one line. See below.

---

### Q10. Two of six platforms are live. Is this actually a product?

**Why it gets asked.** Because it is a fair reading of the current state.
Bluesky and RSS are running. Instagram, TikTok, Facebook, X and YouTube are not.
Bluesky is a small platform. A competitive intelligence tool that measures one
small platform is a demo.

**Draft answer.**

"Right now, no. Right now it is a working system with one platform's worth of data
in it, and I would not put its numbers in front of the masthead today.

The reason those two are live is that they are the two that need no approvals and
no money. I turned on what I could turn on in a day.

The other five need one of two things. Some need an application to the platform,
which takes weeks and can be refused, and I would start those regardless of what
we decide here because they cost nothing but calendar time. The rest need about
175 dollars a month from a data vendor, which is the thing I want to talk to legal
about before we do it.

So the honest state is: the pipes work, the data is thin, and the thinness has a
price tag and a date. That is a different problem from software that does not
work."

---

### Q11. AI built most of this and there are no tests. Why would we trust a number that comes out of it?

**Why it gets asked.** Because it is the correct instinct, and because a wrong
number in a leadership deck is a much worse outcome than no number. Also because
"an AI wrote it in an afternoon" invites exactly this.

**Draft answer.**

"You should not trust it yet, and I have not asked you to.

Two separate risks here and I want to keep them apart.

Risk one is bad arithmetic in the code. Real, and unmitigated today. There are no
tests. The part that most needs them is the part that adds up the numbers. That is
about a week of work and it is the first thing in the plan. Until it is done, no
Data Dumpster number goes into anything you or the masthead reads. I will hold that
line myself.

Risk two is the AI writing something that is not in the data. That one is already
solved, and it is the part of this I am proudest of. The AI is not allowed to do
arithmetic. The numbers are computed by the database, handed to the model as a
fixed list, and the model is only allowed to write sentences around them.
Afterwards, code checks every single number in the document against that list. If
one does not match, the document says so at the top, before anyone reads it. And
the exact numbers the model was given get stored alongside the document forever, so
when somebody challenges a figure in a meeting a year from now, the answer takes
forty seconds and it is a receipt, not a shrug.

That is the mechanism. Most tools with an AI summary button have a disclaimer
instead."

---

### Q12. You want to buy scraped data. We are a newspaper. Have you thought about that?

**Why it gets asked.** Because the 175 dollars a month buys data collected
without the platforms' permission, and because a newsroom that has covered platform
data practices buying scraped data is a story a competitor would enjoy writing.
Raise this before anyone else does. If you get caught not having thought about it,
you lose the room.

**Draft answer.**

"I want to raise this before you find it, because it is the part of the plan with
real reputational exposure and I do not think the legal exposure is the main issue.

Facebook has a sanctioned route through Page Public Content Access after App
Review; Data Dumpster currently uses Bright Data for existing pooled profiles.
TikTok's research programme excludes this commercial use, and LinkedIn's official
organization APIs are owned-only, so those competitor paths require an approved
purchased public-data source. Data Dumpster implements Bright Data for both,
with LinkedIn limited to followers, posts, likes and comments and every history
window source-limited. The decision is therefore source-by-source: approve the
purchased path with provenance and spend controls, or disable it and label the
gap.

My read on legal risk is low. We would be a customer, not a collector. The data is
public engagement counts on organizational accounts. We would not republish it or
train anything on it. Recent court decisions have gone in the vendors' favor on
exactly this fact pattern. But I am not a lawyer and I want counsel to say that,
not me.

My read on reputational risk is that it is the real one, and it is asymmetric for
us specifically. The defence is correct and boring, and boring defences do not
survive headlines.

So here is what I would propose. Ask counsel. Tell newsroom leadership before
somebody else does. If either says no to a purchased path, disable that path and
label the gap in the product itself. Do not substitute an owner credential or
invent a fixed cost from the July research estimate. That is a genuinely
acceptable outcome, not a consolation prize.

One more thing you should know. A commercial tool can obtain Facebook through
PPCA or a purchased source; TikTok and LinkedIn competitor views require a
commercial agreement or public-page collection outside their official owned
APIs. Ask the incumbent for exact provenance rather than assuming it. If we
decline purchased collection on principle, that is a defensible choice for a
newsroom. It should be made on purpose, not by accident."

---

### Q13. How does this connect to subscribers and revenue?

**Why it gets asked.** Because a consumer revenue company measures things by
their distance from a subscription, and because platform metrics that float free of
the business are exactly the pattern you have been asked to fix.

**Draft answer.**

"Right now it does not, and I want to be precise about that rather than draw a
dotted line I cannot defend.

Today it answers a narrower question: are we holding attention in the places
readers still are, compared to the people competing for the same attention. That
matters because the two channels that used to send us readers, social referral and
search referral, are both gone or going. What is left is the relationship we own.
Subscription, newsletter, app, habit.

Here is the part that connects, and it is the reason I built the plumbing this way.
The system already pulls out every link in every post and stores where it goes.
Join that against our own analytics and our subscription events and you can answer
a question I do not think anybody in this industry answers well: which stories,
distributed how, produced a registration or a subscription.

That is the actual product I want. The competitive tool is how you build the
ingestion, the metric discipline, and enough organizational trust that anyone lets
you near the subscription data.

I would put that on the 90-day list as one narrow question. One brand, one month,
end to end. If we can answer it, this stops being a social tool and becomes the
first layer of something bigger. If we cannot, I was wrong about the thesis."

---

### Q14. Who else wants this? Has anyone in the newsroom asked for it?

**Why it gets asked.** Because a tool with one enthusiastic owner and no
constituency does not survive, and because "Matt built a thing" is a harder sell
than "the audience team asked for this and Matt built it." Also because internal
adoption across teams has been named as a growth area, and this is the test case.

**Be honest, because the honest answer is not good, and pretending otherwise is
worse.**

**Draft answer.**

"Nobody asked for the software. The problem is well-known and the software is my
answer to it, and those are two different things. I want to be straight about that.

What I would do about it, before the next conversation rather than after: sit with
Carolyn and the social team and have them tell me what is wrong with it. Not a
demo, a working session. Then take the same session to the newsroom side.

And there is a specific thing I want to do first. The tool currently shows us
ranking last of five on one measure. Nobody on the social team has seen that yet. If
they hear it from you or from a deck instead of from me, in a room, with the
caveats, I will have made an enemy of the exact team whose adoption decides whether
this lives. So the first showing is to them, this week, before this goes any wider."

---

### Q15. If this is so easy, why is nobody else doing it? And what is the exit if it fails?

**Why it gets asked.** Because "I built a 559 dollar a month product in an
afternoon" is either a genuine shift in what one person can build or it is a claim
that has something missing from it, and it is reasonable to want to know which.

**Draft answer.**

"Both halves of that deserve a real answer.

On why nobody else does it. The reason is not that the software is hard. It is that
the data is hard, and the data got harder. The valuable part of the product we pay
for is thirteen years of stored history and a set of platform relationships, and
neither of those is code. I can rebuild the software in a day. I cannot rebuild the
history at all. That is the honest asymmetry and it is why my recommendation is to
keep paying them while we find out.

On the exit. It is clean, which is unusual and worth saying. We never cancel Rival
IQ during the evaluation. Total new money at risk is one week of engineering and
about 750 dollars of data over a quarter. If it fails, we stop paying 250 dollars a
month, the repo goes cold, and nothing that anybody depends on breaks. There is no
migration, no data lock-in, no contract, and nothing to unwind.

What I would want out of it even in the failure case is the finding in section
three, which we would not have had at all."

---

## 3. The uncomfortable number

**On engagement rate by follower, the Globe ranks fifth of five in its own
competitive set. Behind GBH News, WBUR, Boston.com and the Boston Herald.**

This is the most valuable thing the product has produced and you should treat it
that way. It is also the thing most likely to be misread, in either direction, by
you or by anyone else in the room. Both failure modes are bad: burying it, or
presenting a rank as a verdict.

### The raw numbers, 90-day window, Bluesky and RSS only

| Company | Total engagement | Share of landscape engagement |
|---|---|---|
| WBUR | 5,739 | 47.2% |
| The Boston Globe | 5,182 | 42.6% |
| GBH News | 1,054 | 8.7% |
| Boston.com | 127 | 1.0% |
| Boston Herald | 48 | 0.4% |

The Globe: audience 155,027, posts 299, total engagement 5,182. That is 17.3
engagements per post and 3.3 posts a day. Engagement rate by follower works out to
roughly 0.011 percent, which is about one reaction per nine thousand followers per
post.

### Is it real, or is it an artifact?

**Partly artifact. Not entirely. And the part that is not an artifact is worse
than the ranking.**

The case that the ranking is an artifact, and it is a strong case:

1. **The metric divides by both followers and posts.** The Globe has the largest
   following in the set and posts the most. It carries the biggest denominator on
   both axes. That is arithmetic, not performance.
2. **Three of the four companies ranked above us are statistically tiny in this
   set.** GBH News, Boston.com and the Boston Herald produced 1,229 engagements
   between them over 90 days. The Globe produced 5,182. The Boston Herald ranked
   above us on rate while generating 48 engagements in three months, which is one
   engagement every two days. Any sane minimum-volume floor removes it from the
   comparison entirely.
3. **The metric's own documented caveat says this.** In the product, the tooltip
   on this metric warns that it can flatter very small accounts whose handful of
   loyal followers all engage. That caveat is describing exactly this table.
4. **One platform is not a brand.** This is Bluesky. Bluesky's audience skews
   heavily toward journalism-adjacent and academic users. GBH and WBUR are public
   media. That is close to a home-field advantage. It says nothing about
   Instagram, where most of the actual audience is, and we have no Instagram data
   at all.

**Now the part you cannot explain away, and this is the one to lead with:**

**WBUR beats the Globe on total engagement. 5,739 to 5,182.** That is an absolute
number. No denominator. No rate. No follower normalization. A public radio station
with a smaller newsroom and a smaller following generated more audience reaction
than The Boston Globe over 90 days, on the same platform, in the same market.

And separately: 17.3 engagements per post against a following of 155,027 is a low
number on its own terms, with no competitor in the frame at all. That does not
depend on the landscape, the rate metric, or who else is in the table.

So the finding is not "we rank last." The finding is: **on the one platform we can
currently measure, the Globe is not converting the largest following in the market
into the most audience reaction, and a much smaller newsroom is beating us in
absolute terms.** That is defensible, it is not a denominator trick, and it is
worth an executive's time.

### What would confirm it

Do not present the finding without presenting this list. The list is what makes it
credible rather than alarming.

1. **Put the denominators in the table.** Followers and posts for every company,
   next to the rate. A rank order with the denominators hidden is not a finding, it
   is a provocation. This is a one-hour fix and it should be done before the
   meeting.
2. **Apply a volume floor and rerun.** Exclude any company below, say, 200
   engagements or 50 posts in the window. Boston.com and the Herald almost
   certainly drop out. Report both versions. If the Globe still trails WBUR and
   GBH with the floor applied, the finding survives its own strongest objection.
3. **Check it against the tool we already pay for.** Rival IQ covers Instagram,
   Facebook and X, which Data Dumpster does not. If the Globe also trails on engagement
   rate there, this is not a Bluesky story. If the Globe leads there, this is a
   platform-specific finding and should be presented as one. **This check is free
   and you can do it before the meeting. Do it.**
4. **Get the trend, not the snapshot.** Is our rate falling, flat, or rising over
   the 90 days? Last place and improving is a completely different story from last
   place and deteriorating. Right now you have a photograph and you need a film.
5. **Split posts by type.** 299 posts in 90 days on one platform is high cadence.
   Check whether the low rate is driven by a large volume of automated headline
   posts diluting a smaller number of high-performing human ones. If so, the fix is
   operational and cheap, and you should bring it as the fix.

Item 5 is the one most likely to produce an actionable answer, and it is the one
that turns this from a problem statement into a recommendation.

### How to raise it with an executive

**Lead with the question, not the rank.** "Why does WBUR get more reaction than we
do?" is a question an executive leans into. "We are last of five" is a statement
that produces either defensiveness or a demand for someone's head, and neither of
those helps you.

**Give the number its perspective in the same breath.** Never state the rank
without immediately stating that three of the four companies above us produced ten
percent of the engagement in the market between them. The number is not the
finding. The number plus its context is the finding.

**Bring the confirmation plan with the finding.** Say plainly: this is one
platform, 90 days, five companies, and here are the four things that would confirm
or kill it, and here is when I will have them. That is what separates an analyst
from an alarmist.

**Tell the social team first.** This week. Before this document goes anywhere.
Carolyn and the social team should hear this from you, in a room, with the caveats,
and they should have a chance to tell you what is wrong with it before an executive
sees it. If they learn their team ranked last from the CEO, you lose that coalition
permanently and you will never get the adoption this needs. This is not politeness.
It is the single highest-leverage sequencing decision available to you.

**Frame it as capacity, not failure.** WBUR is not out-resourcing us. They are
out-converting us. That means the gap is addressable with what we already have,
which is the version of this finding that is useful rather than demoralizing.

**And say the meta-point explicitly, because it is the real argument for the
tool:** "We have paid for a competitive intelligence product for years. This is the
first time anyone has put this specific comparison in front of you. That is not a
criticism of the vendor. It is what happens when the numbers live somewhere nobody
on my team can interrogate them."

---

## 4. Where the pitch is weakest

Blunt. These are the three things most likely to sink the meeting.

### Weakness 1: docs/PITCH.md is written for a job interview at another company

Read it again. It opens with "what I would do with the first ninety days of a CTO
or CPO role." Section 6 is titled "What I would want from the role" and asks for
scope, a mandate, permission to buy, and four engineers. Section 1 says "as far as
I can tell from the outside" and declines to name the Globe's subscriber count
because "a candidate who does should worry you."

That document is an application for a job at a company that is not this one.

**If that file reaches the CEO, the meeting is not about Data Dumpster anymore.** It is
about whether you are leaving. Every other argument in this preparation document
becomes irrelevant. This is by a wide margin the biggest risk in the room and it has
nothing to do with the software.

**How to get ahead of it:**

- Do not send the repository. Do not share a link that browses the docs folder. Do
  not say "it's all in the repo, take a look."
- Write one page for this meeting, from scratch, addressed to her. The opening
  paragraph in section 1 of this document is the first third of it.
- Before any of this is shared internally, either delete PITCH.md, or rewrite it
  as an internal memo with the role-seeking framing stripped out. Sections 1
  through 4 and 7 survive that edit fine. Sections 5 and 6 do not.
- If it does come up, do not be cute about it. "I wrote that as an exercise in
  arguing the strategic case from first principles. It reads like an outside
  pitch because that is the frame that forces you to justify everything. Here is
  the internal version." Then hand her the one-pager. Have the one-pager.

### Weakness 2: your own documents conclude that buying wins

BUILD-VS-BUY.md says it in the second sentence: buying Rival IQ is cheaper, three
to five times over, and it does not flip at any realistic scale. That is your
document, and it is a good document, and it is currently the strongest argument
against you in the building.

The risk is not that the analysis is wrong. It is that if she encounters it before
you frame it, she reaches the conclusion without the counter-argument attached, and
you spend the meeting relitigating your own memo.

**How to get ahead of it:** say it first, in your own voice, in the first five
minutes. See Q2. The sentence you want is "on cost, buying wins, and here are the
three things that are not about cost." Volunteering the number that hurts you is
the only way to keep control of what it means. If she has to find it, it becomes a
gotcha. If you hand it to her, it becomes evidence you can be calibrated.

### Weakness 3: "one afternoon, no tests, two of six platforms" reads as an experiment

Say those three facts in a row and it sounds exactly like the thing you have been
told to stop doing. The word "experiment" is a yellow flag and this has its
fingerprints on it.

There is a second-order version of the same problem and it is worse. The tool's
current headline finding is that the Globe ranks last. So the first impression is:
a one-day build, with no tests, on one small platform, whose main output is bad news
about us. That is a hard first impression to recover from if it lands unmanaged.

**How to get ahead of it:**

- Never say the three facts consecutively. Say each one where it belongs, attached
  to a mitigation. No tests goes with "one week, and no number ships before it."
  Two platforms goes with "175 dollars a month and a legal question." One
  afternoon goes late in the meeting, or not at all.
- Lead with the finding, not the artifact. The finding is not an experiment. The
  finding is a fact about our distribution that we did not previously have.
- Bring the stop conditions unprompted. Experiments do not have written kill
  criteria with dates. Deployments do. This is the single clearest signal available
  that you internalized the directive.
- Use the word deploy. Do not use pilot, experiment, try, test-drive or prove out.
  Do not use efficiency at all. Capacity, ability, expand.

---

## 5. What to ask for

Keep it small. Small is credible. A large ask on a one-day-old tool with no tests
invites a no, and a no here is expensive because it is hard to reopen.

### The ask, in one sentence

**One week of one engineer's time, about 250 dollars a month of data and hosting
for one quarter, and two named owners. Keep paying Rival IQ the entire time.
Decide with evidence on 31 October.**

Broken out:

| What | Amount | Why |
|---|---|---|
| Engineering, one time | About one week | Tests over the code that computes numbers. Nothing ships to leadership before this lands |
| Engineering, ongoing | 4 to 8 hours a month | Platform APIs break. Somebody has to fix them |
| Cash | About 250 a month, roughly 750 for the quarter | Data vendor, hosting, database, AI inference |
| Rival IQ | Unchanged | Not cancelling anything. It is the control group and the fallback |
| Operating owner | One named person | Reads the weekly output, owns whether it is right |
| Engineering owner | One named person | Owns the code when you are not looking at it |
| Legal | One conversation | Whether we can buy data collected from public pages |
| Decision date | 31 October 2026 | Written recommendation, with the quarter's evidence in it |

Total new money at risk: about 750 dollars and one engineer-week. That is the
number to say out loud, because it makes the decision cheap.

### What you commit to delivering

- Four weekly briefs, read by a named person, by day 30.
- The denominators, the volume floor, and the Rival IQ cross-check on the
  engagement rate finding, by day 14.
- A written build-versus-buy recommendation on 31 October with the quarter's data
  in it, including the recommendation to buy if that is where the evidence goes.
- One end-to-end answer by day 90: for one brand, one month, which social
  distribution produced registrations or subscriptions.

### Tripwires. Any one of these and we stop.

Say these out loud in the meeting. This is the part that answers the deploy
question without you having to argue about it.

1. **No named owner by 11 August.** Stop. Keep Rival IQ. The repo goes cold. This
   is the decisive one and it is not close.
2. **Tests not landed by 27 August.** No Data Dumpster number appears in any leadership
   material, ever, until they are. Not a soft rule.
3. **Data Dumpster and Rival IQ disagree by more than ten percent on any shared metric
   and the cause is not found within a week.** Stop. A measurement tool that cannot
   reconcile against a commercial one is not a measurement tool.
4. **Fewer than three of the first four weekly briefs actually read.** Stop. An
   unread brief is a tool nobody wanted.
5. **Legal says no to the data vendor and the sanctioned-only version still leaves
   three of six platforms blind.** Then buying wins on coverage and we say so.
6. **No logged publishing decision changed by 31 October.** Stop. That is the whole
   thesis and there is no proxy for it.
7. **Anyone on the social team has to ask Matt to run a query for them.** The tool
   is not self-serve enough and that was half the point.

Tripwire 7 is the one that connects to the standing feedback about self-serve
access and breaking down silos. Do not drop it.

---

## 6. Questions you probably have not considered

Four. These are the ones that get asked in the follow-up meeting, or worse, in a
room you are not in.

### 6.1. Your team now owns the scoreboard it is graded on

The definition of "engagement" lives in a TypeScript file that you wrote. Your
team's performance is measured by that number. Those two facts together are a
governance problem and it does not matter that your definitions are careful and
well documented.

Rival IQ's neutrality is a product feature you are giving up, and it is not on
your build-versus-buy comparison table. It should be.

Have an answer before someone else finds this. The answer is probably: a named
person outside Platforms, in the newsroom or in Tom Brown's shop, has to approve
any change to what "engagement" means, and metric definition changes are logged
with a date and a name. That is a half-day of work and it removes the entire
objection. Do it before the meeting and you get to mention it as a feature.

### 6.2. What happens the first time a Data Dumpster number contradicts a number
already in a leadership deck?

It will happen, probably in the first month, and the reconciliation meeting that
follows decides whether the tool survives. Whoever loses that argument loses more
than the argument.

Decide in advance, in writing, and with the other parties bought in: which system
is authoritative for which number. Get agreement from D-Raj and Tom Brown before
you ship, not after the conflict. This costs one email now and a great deal later.

Related and worth thinking about: the subscriber number reporting already has a
precedent for this. There are two numbers, 260K and 313K, and there is a documented
rule for which audience gets which one. Data Dumpster needs the same kind of rule and
you already know what a good one looks like.

### 6.3. This is one query away from being an individual performance measurement
system

Data Dumpster does per-post outlier scoring and desk-level tagging. Point that at
authorship data and you have a per-journalist, per-social-editor performance
scoreboard. Nobody has to intend that for it to happen. Somebody just has to ask
for it once and get a yes.

Labor relations implications have already come up in the AI guidance work for
exactly this class of reason. The augmentation-not-substitution framing exists
because someone thought about it in advance.

Decide now, write it down, and say it in the meeting before anyone asks: Data Dumpster
does not report at the individual byline or individual staff level, and that is a
product decision enforced in the code, not a policy in a document. Saying this
unprompted buys you a lot of trust with a constituency you need and do not currently
have.

### 6.4. Who decides who our competitors are, and are they even the right ones?

Every number in the product moves when the landscape changes. Share of voice,
share of engagement, and every rank. The current set is WBUR, GBH News,
Boston.com, and the Boston Herald.

Two problems with that.

First, it is a judgement call currently made by whoever set up the configuration,
which is you. It should be made by the audience team in a meeting, on the record,
with a name attached. Otherwise every uncomfortable ranking is arguable on the
grounds that the set was chosen badly.

Second, and this is the more interesting one: **is a Boston local set even the
right competitive frame for a consumer subscription business?** The Globe ranks
36th globally among English-language digital publishers with 100K or more
subscribers, ahead of the LA Times, and that peer list is the frame that has
actual leadership attention. On the Press Gazette list our competitors are the LA
Times, the Chicago Tribune and the Philadelphia Inquirer. In Data Dumpster they are the
Boston Herald and GBH.

Those are two different companies. Which one you are measuring says a lot about
what you think the Globe is competing for. There is a strong argument that the
right Data Dumpster landscape includes the Press Gazette peer set, not just the local
one, and that reframing alone may be the most valuable configuration change
available. It also connects the tool directly to a number leadership already cares
about, which is the thing you have been asked to get better at doing.

### 6.5. Bonus, and it is the sharpest one

**Has Rival IQ been telling us this for a year already?**

If the Globe has been trailing on engagement rate in a product we already pay for,
and nobody acted on it, then the problem was never the tool. It was that nobody
read it, or nobody owned it, or nobody could do anything with it.

Find this out before the meeting. Log into Rival IQ and check.

If the answer is yes, the whole pitch changes, and it changes in your favor. The
argument stops being "we need a better tool" and becomes "we need someone whose job
is to act on this, and here is a tool that makes acting on it possible." That is a
stronger argument, it is cheaper, and it is far more likely to survive contact with
an executive who has seen a lot of tools.

If the answer is no, because Rival IQ does not cover Bluesky at all, then you have
a clean and specific case for why the new tool found something the old one
structurally could not. Which is also a very good argument.

Either answer helps you. Not knowing does not.
