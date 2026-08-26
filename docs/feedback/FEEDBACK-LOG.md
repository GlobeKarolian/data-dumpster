# Data Dumpster feedback log

The running record of what users ask for, what got promised, and what shipped
because of it. Sources: demos, Slack, email, hallway. One entry per session in
the log at the bottom; the rolled-up state lives in the tables up top so the
newest transcript never has to be re-read to know where things stand.

How to add: paste a transcript or a one-line Slack ask into the session log,
then reflect it in the tables. Nothing gets deleted; closed items move to
Shipped so the loop is visible.

---

## Open requests, ranked

Ranked by demand signal and cost to build, not by who asked loudest.

| # | Request | Who / when | Status | Notes |
|---|---------|------------|--------|-------|
| 1 | Hashtag + caption SEO analysis: which hashtags and caption terms drive lift, per platform, ours vs competitors | Cecilia, Aug 24 | Open | Cheapest high-value build on the list. Hashtag data already collected, never analyzed. Lift machinery from tags reuses almost directly. TikTok-as-search is the use case. |
| 2 | Subtopic drilldown inside a big tag ("micro-tagging"): apply topics-over-time within Lindsay Clancy and watch subtopics emerge | Rami, Aug 24 | Open | The strongest editorial case anyone has made for the tool: the husband conspiracy theories were visible two weeks before Opinion noticed, and three people are now chasing that story a month late. "How can we find what we're missing" inside the story taking up oxygen, not what other stories exist. Partly depends on #3. |
| 3 | Comment ingestion: store and process comments, not just posts | Rami sparked it, Matt committed in-room, Aug 24 | **In progress** | Would have surfaced the conspiracy theories quickly; 100-300x more text than posts. Needs spend design from day one given the Bright Data history — the vendor_spend ledger and per-round caps exist now, use them. Probably scoped per-story, not always-on. **Aug 25–26: Instagram ingestion live (first round 1,795 comments / 25 posts / $2.68); TikTok joined after a live probe; AI section summaries shipping; costs screen added. Remaining for full close: Facebook comments, the analysis layer, and the per-story scoping this entry called for.** |
| 4 | On-demand listeners: temporarily point collection at a subreddit or community when a story warrants it | Rami, Aug 24 | Open | His framing: a trained analytics-homepage hybrid flips a "listening bug" on the true crime subreddit when the next Lindsay Clancy starts. Bounded, per-story collection rather than perpetual scraping. |
| 5 | Click through from a story-arc day to the posts behind it | Promised to Cecilia in demo, Aug 24 | Open, promised | Said "soon, on the roadmap" out loud. She has a week of exploration ahead; this is the gap she hits first. |
| 6 | Methodology page: how each metric is computed, per platform | Cecilia, Aug 24 | Open | She asked directly whether engagement rate is ours or the platform's. When our number disagrees with a native dashboard she needs something to cite. Tooltips exist but are not citable. |
| 7 | Invite flow: provision landscape access during the invite, not after signup | Self, bitten twice on Aug 24 | Open | Called it a sequencing mistake in Cecilia's demo, then hit it again an hour later inviting Rami. Every new user is a two-step manual chore. |
| 8 | Opinion landscape | Offered to Rami, Aug 24 | Open, offered | "We want to build out a landscape for you guys if you guys want it." Follow up on what accounts they would track. Editorial board candidate tracking is the stated value. |
| 9 | Ask-the-tool agent: natural language questions with good answers | Rami, Aug 24 | Open, architecture exists | Current honest state, said in the demo: "you can jump in and ask a question, you will not get a good answer." |
| 10 | Predictive post performance, with an explicit "not enough data" threshold | Discussed with Rami, Aug 24 | Open, design principle set | Both agreed the model should default to "I don't know" on novel topics so prediction never discourages new things. The threshold is the product decision, not the model. |
| 11 | Historical backfill as a standing capability, not a favor | Cecilia (Carla will press), Aug 24 | Open | Everything forward is kept; backfill on request works (MLB to opening day). Needs to become self-serve or at least documented. |
| 12 | Visual / image processing for tagging | Promised in both demos, Aug 24 | Open, promised | Cost-gated: text is cheap, images are not. "See how good text alone gets" first. |
| 13 | Video closed-caption ingestion for tagging | Promised in both demos, Aug 24 | Open, promised | TikTok captions + CC as a tagging source. Richest untapped signal for video-first accounts. |
| 14 | StoryCloud / glanceable visualization of a week's narratives | Self, asked both demos for ideas | Open, immature | Rami's answer redirected it: the valuable glance is inside the dominant story (#2), not across stories. |
| 15 | Story-type tags under-apply | Self, Aug 23 | Open, known defect | The NESN Roman Anthony post should also carry "Home Runs & Highlights" and does not. Weakest layer in the taxonomy. |
| 16 | Election Center stance detection: does a response agree or push back | Self, deferred Aug 23 | Deferred | Held back to ship the honest version first. Revisit if training surfaces appetite. |

## Commitments outstanding

- [ ] Provision Cecilia's dataset access once she creates her account. Invite
      expires ~Aug 31; if she has not signed up by then, re-send.
- [ ] Provision Rami's access once he signs up (invite sent in-room Aug 24).
- [x] Scope comment ingestion. Said "we should start pulling in all of the
      comments" in the room; the commitment is to a scoped design with a spend
      ceiling, not an unbounded collector. We have been burned exactly here.
      **Scoped and shipped Aug 25–26: vendor-enforced caps, per-platform daily
      record budgets (4k each), one-pass-per-post policy (buy once, ~12h after
      posting), every purchase ledgered before anything can fail, live cost
      visibility on Settings → Costs. First rounds: Instagram 1,795 comments /
      $2.68; TikTok sections ~10x louder by likes.**
- [ ] Follow up with Rami on the Opinion landscape: which accounts, which
      competitors.
- [ ] Schedule the Boston.com session with Carla and Jason. Two independent
      requests now: Kaitlyn Johnston (Sept 16 or 23 noon, open since Aug 13)
      and Cecilia unprompted.
- [ ] Regroup with Cecilia after her week of exploration, ~Aug 31.
- [ ] Reschedule the Red Sox / FSG session (Greg Sherman, Kelsey Doherty,
      Colin) if that stays live.

## Shipped because of feedback

The section that makes giving feedback worth anyone's time.

| Shipped | Origin | What went out |
|---------|--------|---------------|
| Aug 11 | D-Raj: the numbers are not worth much if only your team can reach them | Self-service request-access on the login page; weekly report shareable by link and aggregated across BGM brands |
| Aug 21 | Red Sox / FSG interest in season-long context | MLB landscape backfilled to opening day; milestones-and-records quantification demoed on their data |
| Aug 21 | Self: refresh panel hogs the screen | Progress panel no longer auto-opens |
| Aug 24 | Self: Group View nowhere near the data richness of the rest of the tool | Full dashboard rebuild: trends, topics, link share, cadence, top posts, honest coverage disclosure |
| Aug 25 | Rami: the signal lives in comments (open #3) | Instagram comment ingestion live in production: vendor-bound caps, spend ledger, $2/day scale. First round: 1,795 comments off 25 posts for $2.68. Facebook and the analysis layer are the next stages. |
| Aug 25 eve | Same thread, same night: trust but verify the spend | Costs screen + universal vendor metering: every Bright Data delivery writes to the vendor_spend ledger at arrival; admin screen shows model actuals vs vendor estimates daily, never silently blended. Born from the $232 group-collection invoice nobody saw for a day. |
| Aug 25 eve | Comments need readers, not just storage | AI comment summaries: one glanceable 2–3 sentence read per collected section in the post dialog, model recorded on the row, $1/day cap, validator prefers silence over wrong prose. Hostile themes attributed as commenter claims, never adopted. |
| Aug 25 late | TikTok sections are where the audience actually talks | TikTok joins the comment program after a live probe (top comment 2,953 likes vs IG's 339): platform-configured collector, separate 4k/day record budgets so neither platform starves the other, both shapes pinned verbatim in tests. |
| Aug 26 | Deep links kept dying in Slack | Post dialog rides in the URL (`?post=<id>`): "where are the comments" became a link instead of directions. |

---

# Session log

Newest first. Raw takeaways per conversation; the tables above carry the state.

---

## Build-out session — Aug 25–26 2026 (comment program sprint)

Five commits landed the evening of Aug 25 into Aug 26, all serving open #3.
This entry records what shipped against the Rami commitment so the next reader
does not have to re-read git.

1. **Instagram comment ingestion live** (`52f3dff`). Bright Data dataset,
   vendor-enforced caps, one pass per post (~12h after posting, busiest first,
   never re-bought). First production round: 1,795 comments off 25 posts for
   $2.68. Whole corpus runs about $2/day.
2. **Costs screen + universal metering** (`127e9d7`). Every Bright Data
   delivery now writes to `vendor_spend` the moment it lands, via a hook in
   the vendor client (groups/comments keep their own richer rows; no double
   count). Settings → Costs shows 30 days of daily spend split model-actuals
   vs vendor-estimates, plus today/yesterday/7-day/MTD tiles and per-feature /
   per-dataset breakdowns. Admin-gated. Directly answers the $232
   group-collection invoice that lived on the vendor's dashboard for a day.
3. **AI comment summaries** (`6c6a2ad`). Model reads each collected section
   (top 80 by likes), writes two-three sentences, shown above the raw sample
   in the post dialog. Labeled AI summary, model recorded on the row. Same
   job shape as story narratives: bounded tick, time budget, $1/day,
   candidates found by absence of a row, strict schema, validator rejects
   rather than scrubs. New table `comment_summaries` (migration 0035).
4. **Post dialog deep links** (`5e89425`). `?post=<id>` opens the dialog on
   arrival, fetch-by-id when the post is not on the loaded page. Asked twice
   in demos ("where can I see the comments") — now the answer is a URL.
5. **TikTok joins** (`cb460d0`). Probed first: Boston 25 Clancy video, full
   ISO timestamps, real field names, top comment 2,953 likes (IG high-water:
   339) — an order of magnitude louder, richer vein for theme detection.
   Collector is now platform-configured: own dataset id, own 4k/day record
   budget, five posts per platform per tick busiest-first. One parser reads
   both vendors via non-colliding key fallbacks; both shapes pinned verbatim
   in tests carrying the probed records.

Also fixed the same window, adjacent but worth the record:

- **Instagram stub corruption caught and stopped** (`e3faa49`). Around Aug 22
  Bright Data slimmed profile-embedded post stubs to seven fields: no likes,
  no comments, date-only datetime. Parser wrote zeros and midnight-UTC
  timestamps → three days rendered as every account posting at exactly 8PM
  with zero engagement (143/146 posts Aug 24, 176/178 Aug 23, 83/91 Aug 22).
  Verified against a live purchased profile row. Fix: a metric-less stub is
  evidence a post exists, not an observation — refused (`stubsUnusable`),
  date-ranged stage buys real observations even for short windows, damaged
  rows heal on next collection via upsert. Repair pass for history still open.
- **Tagging queue resilience** (`1a50316`): a billing outage no longer
  permanently parks the queue. **Tagging monitor** (`9261ea2`): says when the
  reader is stopped; Politics no longer eats the chart.

State after the sprint: typecheck clean, 658/658 tests passing. Still open on
#3 before calling it closed: Facebook comments, the cross-post analysis layer
(theme emergence over time — which is also where #2 micro-tagging would land),
and the per-story scoping decision.

---

## Rami Abou-Sabe (Opinion) — demo, Aug 24 2026

**His read on the use case, in his words:** "The coolest thing to me is on the
back end. How can we find what we're missing?" Less interested in what other
topics exist (easy to find elsewhere) than in what is being missed inside the
story already taking up oxygen. Also: candidate tracking "would be of real
value for the editorial board."

**Requests**

1. Micro-tagging (open #2). Apply the topics-over-time view inside a single
   big tag. The proof case: conspiracy theories about the husband were
   bubbling in the Lindsay Clancy conversation two weeks before Opinion
   noticed. Three people are chasing it now and everything they publish will
   feel a month late. "If we could have seen the bubbling up a week before it
   caught our attention, we could have broken the story instead of following
   it."
2. Comment ingestion (open #3). Sparked the in-room realization: the
   conspiracy signal lives in comments, not posts. Matt committed to pulling
   comments in, out loud.
3. On-demand listeners (open #4). Turn a temporary "listening bug" on a
   subreddit or community when a story warrants it, run by a trained
   analytics person in the newsroom, not scraped in perpetuity.
4. Agent interface (open #9). "Can you attach an agent to it and start asking
   questions?" Architecture exists; answers are not good yet, and were
   honestly described that way.
5. Predictive analysis threshold (open #10). Endorsed defaulting to "I don't
   have enough data": as an end user, an explicit I-don't-know is itself the
   signal to take a swing on something new.

**Commitments made in the room**

- Invite sent live; provision access after he signs up.
- Comment ingestion: "we should start pulling in all of the comments."
- Subreddit listening named as something we should probably do.
- Opinion landscape offered.

**Adjacent threads (not Data Dumpster, do not lose)**

- College Town newsletter Instagram: Rami was told the hold came from Matt;
  Matt does not remember it and thinks a separate niche account with collabs
  on the main account is the successful pattern. May have been Linda, who is
  sensitive about new accounts. Rami is parking the handle and checking for
  other pushback. Loose end: if the hold gets attributed to Matt again, clear
  it up.
- Newsletters as on-site franchises: Matt's Hack Week concept (community +
  updates + discussion around a topic, Substack-shaped, on our site). Rami
  strongly agreed and raised the sharper operational problem: most newsletter
  archives live only in Mailchimp, meaning tons of Globe journalism has no
  home on globe.com and would vanish with the account. He went to Substack
  for College Town because our site couldn't do it. Both dubious that
  newsletters-as-savior is the long-term answer; agreed the value is opt-in
  and community, not the inbox.

---

## Cecilia Mazanec (Globe) — demo, Aug 24 2026

**Her read on the use case, in her words:** helpful in "short-term reporting
spurts," and one place to look instead of visiting every platform separately.

**Requests**

1. Hashtag / platform SEO analysis (open #1). TikTok is a search surface for
   her team: titles, hashtags, caption keywords. Wants to know what is moving
   and whether appending a given hashtag carries measurable lift, comparable
   across our posts and competitors'.
2. Metric trust (open #6). Asked whether engagement rate is ours or each
   platform's. "Different platforms calculate things in different ways, where
   it gets tricky for us."
3. Historical retention (open #11). Will everything be kept indefinitely, can
   we backfill. Flagged that Carla will press the same question.

**Commitments made in the room**

- Manual editor invite created live; provision full dataset access after she
  signs up. Invite expires ~Aug 31.
- She plays with the tool for about a week, then we regroup.
- She suggested a joint session with Carla and Jason (Boston.com).

**Promises made during the demo, now on the record**

- Story-arc day click-through to posts: "soon, on the roadmap."
- Image/visual tagging.
- Video closed-caption ingestion.
- Fix invite provisioning sequencing.

---

## Red Sox / FSG — visit, Aug 21 2026 (retro entry)

MLB landscape pulled back to opening day for the meeting. What landed: whole
season of data for all 30 clubs in one place; pitching interest rising over
the season; milestones-and-records as a quantifiable post category. Their
standing problem in their words: they have all of this data and don't know
what should be a post. Follow-up session with Greg Sherman, Kelsey Doherty,
and Colin still to be rescheduled.

---

## Julissa Mijares + Ben Lokshin (STAT) — demo scheduled Aug 24 2026

_Transcript pending._

---
