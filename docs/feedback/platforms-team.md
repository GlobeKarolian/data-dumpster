# Pressbox: Platforms team review

> **THIS IS A SIMULATED REVIEW.** Nothing below was said by a real person. It is a
> role-played critique generated from Matt's own notes (memory/context/company.md,
> memory/context/team-culture-feedback.md, and the People files for Marc Choquette,
> Meredith Ball, Carolyn Freeman, Sadie Layher and Mary Nordmann) plus a read of this
> repo. It is written in their documented voices and concerns as an attempt to
> anticipate real objections before they land in a real meeting. Do not quote it,
> forward it, or attribute any line in it to the person named above it.
>
> Two timeline notes, because they matter for how you read this. Carolyn Freeman went
> on parental leave on 20 July 2026 and is not back until 2027, so her section is a
> reconstruction of the position she has taken on every other reporting tool, not a
> review she gave. Mary Nordmann's co-op ended in June 2026, so her section is written
> as the newest-person-in-the-room perspective the team no longer has in the seat.
> Meredith Ball is currently running Platforms as interim director, which is why her
> section is the longest and the least patient.
>
> Reviewed build: v1, live at https://pressbox-kappa.vercel.app. Data in the system at
> time of review: 1,429 posts, Bluesky and RSS only.

---

## Carolyn Freeman, Director of Platforms

**The question I care about is whether this replaces work or adds work, and right now
it adds work.**

Here is my Tuesday. I pull the landscape numbers, I write the Platforms Dashboard and
Digest, it goes out via Mailsuite, and then people ask me questions about it for two
days. That is the cadence. Any tool either shortens that or it does not exist to me.

Pressbox shortens the part where I defend a number and lengthens the part where I
gather them. Those are not the same size. The gathering is most of the work. If I still
have to open Rival IQ for Instagram and Facebook, then Pressbox is a second tab, and a
second tab is not a replacement, it is a tax. Say that out loud in whatever deck this
gets pitched in, because if leadership hears "internal Rival IQ replacement" and the
reality is "Bluesky and RSS," that gap comes back to my team, not to the person who
built it.

Now the part I actually like, and I want it on the record before I complain more,
because I am not going to be the person who says no to something good.

The tooltip on every metric with the formula and the caveat in it is the single most
useful thing in this product and I do not think you understand how useful. I have spent
a year in rooms where somebody says a number and somebody else says where did that come
from and the conversation dies. Engagement rate by follower with an explanation of why
the denominator is what it is, sitting right there on the label, is worth more to me
than half the charts. Same for the brief verifier. If a document can fail its own check
and say so on its face, I can forward it. I have sat through campaign reports claiming
hundreds of subs that I did not believe for a second and had no way to disprove. This
is the opposite of that, and I want to protect it.

The published share URL is the other thing. Right now when someone in marketing or the
newsroom wants one chart, they get a screenshot from me, because giving them a seat in
Rival IQ is a whole conversation. A read-only link to one dashboard kills a recurring
annoyance.

Operational things nobody has answered:

**Reporting cadence.** Ingestion is a cron. What time does it land relative to when I
write the digest? If the Tuesday morning run fails at 6am and I do not find out until I
open a chart with a hole in it, I am rewriting the digest at 11am. Rival IQ has never
once made me do that, and if it did, it would be their problem and not mine.

**Handoff.** I have just watched what happens when a person goes out and the async
handoff does not fully happen. Everything routed through one head becomes same-day
urgent for whoever is left. Pressbox as currently constituted is entirely in one head.
Before anyone on my team is asked to depend on it for a weekly deliverable, I want a
named owner who is not Matt, and I want to know what that person is allowed to fix.

**What I send upward.** I am not putting a number in front of the masthead that came
out of a system with no tests, and I say that with affection. Marc will say the same
thing louder.

My position: yes to running this in parallel for a quarter, no to touching the Rival IQ
renewal until we have seen what a full quarter of parallel actually looks like.

---

## Marc Choquette, Sr. Director, Search and AI Platforms

**Posted URLs is the good idea. Everything else is a nicer version of something we
already pay for.**

I want to lead with that because it is the thing I would actually fight for. No vendor
in our stack tells me what a competitor is driving traffic to, grouped by domain and by
URL, with engagement per link. Rival IQ does not. Conductor does not. NewzDash does not.
SEMRush gets me a keyword-shaped shadow of it after the fact. Pressbox gets me the
actual link the Herald put in front of an audience on Tuesday and how it did. That is a
search and audience input I have wanted for two years and could not buy.

Pair that with the RSS layer and you have competitor publishing cadence by desk, which
is the thing I currently reconstruct by hand when I am preparing anything for the SLT.
Keep building that. That is the wedge.

Now the problems.

**The sample is not big enough to act on.** 1,429 posts, all Bluesky and RSS. That is
not a competitive landscape, that is a weekend for one account. Bluesky is also not
where our search or referral audience lives. It is where journalism-adjacent people
live, which means a Bluesky landscape tells me how we are doing among other journalists,
which is a real thing but is not the thing I am measured on. Traffic and subs are down
year over year. I cannot walk into a resourcing meeting with a Bluesky chart.

**No tests.** I checked. There is no test script in package.json and there are zero test
files in the repo. I just spent months getting SEO recommendations trusted enough that
Jason thanked us publicly for the Clancy trial work. That trust is the only currency I
have. I will not spend it on a number from a system where nothing verifies that the
number is right. The verifier checks that the prose matches the fact sheet. Fine. What
checks the fact sheet? The SQL that computes it has never been tested against a known
answer. Those are different problems and the docs conflate them.

**URL normalization, and I want a real answer.** If posted-URL grouping is naive I will
get burned in public. What happens with UTM parameters, with syndicated copies, with the
same story on bostonglobe.com and boston.com, with AMP variants, with link shorteners,
with trailing slashes? If those all count as different URLs, the domain rollup is wrong
in a way that looks right, which is the worst failure mode there is. Show me the
normalization rules or the feature is a demo.

**Vendor count.** I said this about the AI licensing market and I will say it here. It
is quickly becoming overwhelming how many things we are asked to check. We have
Conductor on a two-year extension at roughly thirty thousand, NewzDash, SEMRush, Define
Media, Keywee, Rival IQ. Adding a seventh surface that has no support contract and no
owner is not obviously a win just because it is free. Free is a pricing model, not a
cost.

**And the thing I will say in the meeting whether or not anyone wants to hear it.** I am
down a person. Ronke is gone, the SEO Editor backfill is unresolved, and I have a
resourcing meeting on the calendar about exactly this. A tool built in a day is not a
headcount. If Pressbox exists and the answer to my backfill becomes "you have Pressbox
now," I would rather Pressbox did not exist. Please do not let anyone upstairs draw that
line.

---

## Meredith Ball, Senior Project Manager (currently interim director, Platforms)

**Somebody has to be the person who reads the contract, so it is me. Here is the money
version, and it is not the version in the pitch doc.**

**One. Rival IQ is not expensive and that is a problem for this argument.**

Published rate is roughly $239 to $559 a month, fifteen percent off annual, about fifty
a month per five extra companies. Call it three to seven thousand a year. That is real
money and I will not pretend otherwise, but put it next to Conductor at thirty thousand
and Keywee spend and the picture changes. Nobody upstairs is going to give this team a
standing ovation for saving four thousand dollars. If the case for Pressbox is cost, the
case is weak. If the case is "it does things Rival IQ cannot do," which is what Marc is
actually describing with posted URLs, then say that and stop leading with the price.

**Two. Free is not free, and I am the one who has to code it.**

Nobody has given me a line item. Here is what I already see, and I want numbers next to
every one of these before this goes anywhere near a budget conversation:

- Model tokens. The docs are proud that spend is readable in our own database. Good.
  Readable is not the same as budgeted. Who owns that cost center? Does it hit the
  Platforms AI line or the tools line? Chris Zeien and Vincent Ferlisi are going to ask
  me and I want to answer once.
- X reads. The docs say metering, roughly half a cent per post read, and that a naive
  refresh window costs about $1,350 a month against $180 for a sane one. That is not a
  small delta and it lives in a constant in a file called runner.ts that anyone can
  change. That is a budget control living in source code. I do not love it.
- Hosting. Postgres, Vercel, cron. Small, but it is a real recurring invoice with a real
  renewal date and right now it is presumably on somebody's personal account, which is
  its own conversation.
- The scraping vendors in DATA-VENDORS.md. Forty-seven dollars for twenty-five thousand
  credits is cheap right up until legal sees it. Which brings me to the next thing.

**Three. If we ever buy Instagram, TikTok or Facebook competitor data from a scraper,
that goes past Katie Lazares and Lucas Uhl before I sign anything.** The doc itself says
it is a legal and editorial decision, not a technical one. I agree with the doc. I am
flagging it now because I know how this goes. Someone runs a trial on a corporate card,
it works, it quietly becomes load bearing, and eighteen months later I am the person
explaining to legal why a Boston Globe Media product was reading Facebook through an
unsanctioned scraper. Not doing that.

**Four. What we actually lose when we drop Rival IQ, itemized.**

- **The history.** They have been collecting since about 2013. That includes
  CrowdTangle-era Facebook that does not exist anywhere else on earth. Pressbox starts
  its clock the day we run ingest. The day the Rival IQ contract lapses, that history is
  gone and it is not recoverable at any price.
- **Somebody to call.** This is the one people underrate. When Apple flagged the
  Instagram embed bug, there was a ticket and a human and it got fixed. When Meta hacked
  our account, there was an escalation path. With Pressbox the escalation path is
  Slacking the VP of Platforms, and I have watched what one person's absence does to a
  handoff this month.
- **The export clause.** Before anyone decides anything, I want to know what Rival IQ
  contractually owes us on termination. Can we export our historical series? In what
  format? Is there a window? If the answer is that we get a CSV dump on request, we
  should request it now while we are a paying customer in good standing, not after we
  have given notice. That is a two week task and it should start regardless of what we
  decide about Pressbox.
- **Renewal timing.** I need the actual renewal date and the notice period on the
  calendar. Not "sometime this year." If the auto-renew fires while we are still
  evaluating, we have decided by accident.

**Five. The question nobody wants to ask, so I will.**

What happens if Matt leaves? Or takes leave, or gets pulled onto something else for a
quarter? This was built in about a day, largely by AI agents, by one person. There is no
second engineer, no runbook, no support contract, no ticket queue. If it breaks at 6am
before a big story, the team's options are wait or go without. Rival IQ costs us four
thousand a year partly so that a Tuesday morning outage is somebody else's emergency.

I am not saying kill it. I am saying that the honest comparison is not "Pressbox versus
$4k a year." It is "Pressbox plus an owner plus a runbook plus whatever data we buy to
make it useful, versus $4k a year and a support email address." Write that comparison
down honestly and I will help sell it. Write the other one and I will not.

**Six. Two small ones for IT.** The encryption key orphans every stored secret if it is
rotated. Kelly and Daryl will have opinions about a system holding platform tokens and
model keys with that property. And there is a share URL described as unguessable, which
is a security model I would like somebody who is not us to look at before we publish a
dashboard with competitor data on it.

---

## Sadie Layher, Platforms

**I will do the fast version. Does this tell me anything I can use on a Tuesday? Today,
no. And I want to explain why in a way that is not just me being negative, because parts
of this are good.**

**Instagram and TikTok are the job.** Not part of the job. The job. I run bureau social.
The single piece of work I have done here that traveled the furthest was the Real
Housewives of Rhode Island video, and that was a TikTok. I wrote the caption, I ran the
edits with Maria, I got sign-off from Maria Caporizzo. That post is invisible to this
tool. Every post like it is invisible to this tool. A competitive intelligence platform
that cannot see the two platforms where I do my work is not a competitive intelligence
platform for me, it is a competitive intelligence platform for somebody else.

I read the docs. I understand it is not Matt's fault that CrowdTangle died and TikTok
bars commercial research access. I am not blaming the build. I am telling you what my
day looks like. Nobody in Rhode Island is on Bluesky. Not the audience, not the
competitors that matter to me, not the people who made that video go. I cannot bring a
Bluesky chart to a bureau meeting and be taken seriously.

**Here is what I would actually use, and it is closer than you think.**

The outlier score. Engagement divided by that account's own median for that platform, in
window. That is exactly the right idea and it is the thing every other dashboard gets
wrong. A 4.0 means it did four times what that account normally does. That is the number
I have been eyeballing manually for two years. Put that on Instagram and I will open
this every morning.

And the second thing, which I care about more than I am going to admit in a meeting.
Post tags by desk, with lift against that brand's own baseline. If that works, then for
the first time I have receipts. Not a vibe, not a screenshot, an actual line that says
the RI bureau's content outperformed the brand baseline by whatever percent in a window.
I have had work I did get claimed by another team. Having a system that attributes
performance to a desk and a tag, automatically, on a schedule, that nobody can edit
after the fact, is the closest thing to protection I have been offered. That is a real
reason to want this to work.

Which is also why I have a question about the briefs. When Pressbox generates the weekly
brief and it goes upward, whose name is on it? If the answer is that it just appears with
no attribution, then we have built a machine that produces credit-free work, and I have
opinions about how that has gone historically. I would like the brief to name who ran it
and which desks the numbers came from.

**Three more things.**

Owned channels. TikTok's Display API reads accounts we hold a token for. So does
Instagram, properly. That is buildable and it would help me this month, even without any
competitor data at all. Seeing my own bureau accounts next to each other with a
consistent outlier score would be useful on its own. Do that before you do anything
clever.

Alerts. I want to know within the hour when a competitor pops. That is genuinely the
right feature. But hourly alerts over a Bluesky-only dataset is a Slack channel I will
mute in three days, and once I mute it I am never coming back. Do not ship alerts before
there is something worth alerting on.

And do not roll this out to the rest of the building yet. I would rather we used it
quietly, got it right, and showed people a finished thing. We have a track record of
other teams putting their name on our work the moment it becomes visible.

---

## Mary Nordmann, Platforms (junior)

**I am the test case for whether someone who did not build this can learn it, and I want
to be useful by just listing what confused me in order.**

**Getting in.** The README quickstart is npm commands, environment variables, and a
database push. I understand that is for engineers. But there is no page anywhere that
says "you are new, here is what a landscape is, here is what to click first." That page
is maybe four hundred words and it is the difference between me using this and me not
using this. Every tool we buy has one. This one has a repo.

**The vocabulary.** Applause, conversation, amplification, saves. I get why they exist,
you need one word that covers a like and a heart and an upvote. But nobody on this team
says applause out loud, ever. The first time I saw an applause column I genuinely did not
know if it was a real metric or a joke. The tooltips explain it, and the tooltips are
good, but I only found them because I hovered over something by accident. Something should
tell a new person that hovering the labels is where the explanations live.

**Landscape versus company versus channel.** Took me an embarrassingly long time. A
company has channels, a landscape has companies, and I am always inside one landscape but
the page does not make that feel obvious. When I changed landscapes and all my numbers
moved, I thought I had broken it.

**Zeros and blanks.** Some views are 0 and some are blank and I did not know those meant
different things. Apparently blank means the platform will not tell us and 0 means the
platform said zero. That is a genuinely important difference and I only learned it by
reading a docs file that a new person would never open. That should be visible where the
number is.

**Outlier score with no context.** It said 2.1. Is 2.1 good? Is it normal? I had no idea.
The definition is clear, the interpretation is not. If most posts sit between 0.8 and 1.3
then tell me that somewhere, otherwise I am guessing.

**Ask.** I liked it, and I want to say why, because I think it is the best thing here for
someone at my level. It refuses to answer when the fact sheet does not contain the answer,
and it tells you which filter would produce it. Every other tool I have used would have
made something up confidently and I would have believed it, because I am new and I do not
yet know what a wrong answer looks like. A tool that refuses is a tool that is safe to
hand to a junior person. That is real.

The flip side is that a refusal with no obvious next step feels like a wall when you do
not know the system well enough to know what to change. Half the time I did not know what
"widen the date range" was supposed to mean in practice.

**And the question I would have been afraid to ask out loud.** If a chart is broken or a
number looks wrong, who do I tell? There is no support link, no help channel, no
escalation. I am not going to DM the VP of Platforms about a broken chart. I would just
quietly stop using it and go back to whatever the old way was, and nobody would ever know
that is what happened. I suspect that is how this actually dies if it dies.

---

## What we agreed on

1. **Posted URLs plus RSS is the genuinely new capability and it is worth building even
   if nothing else here survives.** Nobody currently sells us competitor link strategy
   tied back to publishing cadence. That is the thing to lead with, not the price.

2. **This does not replace Rival IQ today and we should stop describing it that way.**
   With Bluesky and RSS only, it is a second tab, not a replacement. Everyone who has to
   produce a weekly report agrees on this, and it needs to be said explicitly in whatever
   goes upstairs so nobody makes a budget decision on a misunderstanding.

3. **Nobody has agreed to own it.** Before this becomes load bearing for any recurring
   deliverable we need a named owner who is not Matt, a written runbook for a failed
   ingest, and an answer to what happens when it breaks at 6am on a big news day. The
   answer today is "wait," and the team has just lived through what a single point of
   failure feels like during a handoff.

4. **Export the Rival IQ history now, while we are a customer in good standing.** Whatever
   we decide, the decade of stored series and the CrowdTangle-era Facebook data is
   unrecoverable once the contract lapses. Meredith to find the renewal date, the notice
   period, and the termination export terms. This starts this week regardless.

5. **No number from this system goes in front of the masthead until something tests the
   query layer.** The brief verifier checks that the prose matches the fact sheet. Nothing
   checks that the fact sheet is right. Those are two different guarantees and only one of
   them exists.

6. **Training and documentation are a real deliverable, not an afterthought.** A one-page
   getting-started for non-engineers, the vocabulary explained where the numbers are, and
   a stated place to report a broken chart. Without those, adoption dies silently and
   nobody finds out for a quarter.

7. **The honesty is the best thing about it and it is the first thing that will get sanded
   off.** Labeling a blind spot instead of charting a zero, storing NULL instead of 0,
   printing the caveat next to the metric, refusing to answer a question the data does not
   support. Every one of those will look like a weakness in an executive deck and somebody
   will want it softened. Do not let them.

## What we disagreed on

- **Whether the current data is usable at all.** Marc says a Bluesky-only sample is too
  thin to act on and he will not present off it. Carolyn's position is that the RSS and
  posted-URL layer is already worth a weekly look independent of the social side, because
  competitor publishing cadence is useful even with zero engagement data attached.

- **What to build next.** Sadie wants owned-channel Instagram and TikTok first, because it
  is buildable today and helps her this month. Marc wants URL normalization first, because
  the feature he cares about is quietly wrong without it. Meredith's response was that
  those are both real and you cannot do both without a person, so pick one and staff it
  or admit it is a hobby.

- **The scraping vendors.** Meredith wants the legal question closed with Katie and Lucas
  before anyone runs even a trial. Marc thinks opening a legal file on something we have
  not decided to buy is how you guarantee the answer is no. Unresolved.

- **Whether to tell the rest of the building.** Sadie wants it kept inside the team until
  it is finished, citing what happened the last time this team's work became visible before
  it was credited. Carolyn and Meredith take the opposite view, that quiet work is exactly
  how this team keeps losing credit for things it did, and that visibility early is
  protection rather than exposure. This one got heated and did not resolve.

- **AI tags.** Mary trusts the AI-described tags more than the keyword rules because they
  catch things a keyword list never would, and the model has to quote the words that
  justified the label. Sadie trusts only the deterministic rules, on the grounds that a
  tag which is sometimes right is worse than no tag, because you stop checking. Both of
  them are right and the product should probably show which kind of tag produced a row.

---

*Simulated. Generated from Matt's notes and a read of this repository, July 2026. Not
statements from the named individuals.*
