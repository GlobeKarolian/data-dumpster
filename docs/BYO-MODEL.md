# Bring your own model

**The argument in one paragraph.** Data Dumpster ships no inference. An organisation
points it at a model it already controls, and Data Dumpster adapts. That single
decision settles four questions that otherwise get settled by a vendor: where the
newsroom's content goes, what AI costs, how fast you can adopt a better model,
and whether AI output is trustworthy enough to put in front of an executive. It
is the biggest differentiator in the product and the one an incumbent cannot copy
without giving up a revenue line.

Implementation: "src/lib/ai/types.ts" defines the contract,
"src/lib/ai/registry.ts" is the provider table, "src/lib/ai/client.ts" is the
single call path, and the model_connections table stores one row per configured
endpoint with its own encrypted key and its own per-million-token prices.

Six providers work today: Anthropic, OpenAI, Google, Azure OpenAI, any
OpenAI-compatible endpoint, and Ollama. AWS Bedrock is present in the table and
deliberately unimplemented, failing with a message that names the workaround,
because SigV4 request signing is a different auth model and half-shipping it
would be worse than saying so.

---

## 1. Data governance: where newsroom content actually goes

A newsroom competitive tool sends the model post text. That text includes
competitors' published content, which is public, and it includes the Globe's own
published content, which is also public. So far this is not a governance problem.

It becomes one the moment the product is useful. The natural next features are
the ones in the Later list of the PRD: tagging against internal desk taxonomies,
briefs that reference unpublished plans, questions asked in the Ask box that
contain embargoed context ("how did coverage of the story we are running Thursday
compare to..."). The Ask box is a free text field. People type things into free
text fields.

With a hosted-model SaaS product, the honest answer to "where does that go" is a
subprocessor list and a DPA. That is a real answer and for most companies it is
sufficient. For a newsroom it is a weaker answer than it looks, for three
reasons.

**A newsroom has categories of material that are not merely confidential.**
Source-identifying information, pre-publication investigative work, and material
under a legal hold have consequences that a contractual remedy does not cure. A
breach notification does not un-identify a source.

**The subprocessor list is not stable.** It is a vendor's business decision,
changed with notice, and each change is a new review or an accepted risk.

**Nobody in the newsroom will read it.** The people typing into the Ask box are
social editors, not the general counsel's office. Governance that depends on
every user knowing the data flow is governance that fails.

Bring-your-own-model changes the question from "do we accept this vendor's data
handling" to "which of our existing, already-reviewed inference relationships
should this use". If Globe Media has an enterprise agreement with a model
provider, Data Dumpster uses it and inherits its terms. If a category of work should
never leave the building, point that org's connection at Ollama and it does not.

### Running fully on-premises

The Ollama provider takes a baseUrl and no API key. Set a model connection to
Ollama with a baseUrl of "http://ollama.internal:11434" and a model of
"llama3.3:70b" or similar, and every AI feature in Data Dumpster runs against hardware
the Globe owns, with no network egress.

The honest version of this: it is a governance tool, not a cost tool. For fifty
briefs a month, running your own GPU is dramatically more expensive than an API
call (section 3 has the arithmetic). The reason to do it is that for embargoed
material, pre-publication investigation, or anything under legal hold, "the text
never left our network" is a stronger statement than any contract, and it is
verifiable by anyone with tcpdump.

The right configuration is probably both. Configure two connections: a fast
hosted model as the default, and an Ollama connection selected explicitly for
sensitive work. The schema supports many connections per org with one default,
and every AI call takes an optional connectionId.

---

## 2. Cost transparency versus per-seat AI markup

Every AI call in Data Dumpster goes through one function, "complete()" in
"src/lib/ai/client.ts", which writes a row to the ai_usage table: org,
connection, feature, input tokens, output tokens, cost in dollars, latency,
success, error. The cost is computed from the per-million-token prices stored on
the connection itself, which the person configuring it entered or accepted from
the provider's suggested list.

The consequence: an organisation can answer "what did this cost us, by feature,
this month" from its own database, in SQL, without trusting anyone's invoice. The
Settings page renders it, and the underlying table is queryable directly.

The industry alternative is a per-seat AI markup. The published pattern in
mid-2026 is roughly 7 to 30 dollars per user per month for an AI add-on:
Microsoft 365 Copilot lists at 21 dollars per user per month on Business and 30
on Enterprise, and Slack AI's entry summarisation tier is about 7.25 per user per
month. Those are list prices for general-purpose assistants and they are not
unreasonable prices for what they do. The point is the shape of the pricing, not
the level: it scales with headcount and it is entirely disconnected from token
consumption.

For a feature like a weekly competitive brief, that shape is badly wrong. Fifty
briefs a month is fifty briefs whether four people read them or forty. A per-seat
model charges more for the same compute as the tool succeeds internally, which is
an active disincentive to roll it out to the people who should have it.

---

## 3. Worked cost example: fifty weekly briefs a month

### The assumptions, stated so you can attack them

A brief prompt is the honesty rules plus the voice rules plus the output shape
(about 1,600 tokens, static) plus the rendered fact sheet. The fact sheet is the
slimmed JSON plus a flat number index capped at 600 entries by "numberIndex()" in
"prompts.ts". An index line looks like
"facts.leaderboards.engagementTotal[3].previousValue = 41208", roughly 16 tokens,
so a full index is about 9,600 tokens. The JSON carrying the same values plus
keys, company names, ten top posts with text trimmed to 400 characters, tag rows
and URL rows runs roughly twice that.

**Input: 30,000 tokens per brief. Output: 1,500 tokens.**

Verification failures trigger one repair turn, which resends the original
messages plus the draft plus the failing strings: about 32,000 input and 1,500
output. I have assumed a 30 percent repair rate. **That number is a guess.** It
has not been measured against real Globe data and it is the single largest source
of error in this table. Measure it from the ai_usage table after two weeks and
replace it.

Fifty briefs plus fifteen repairs comes to about **1.98 million input tokens and
98,000 output tokens per month.**

### What that costs, at July 2026 list prices

| Provider and model | Input / output per Mtok | Monthly cost |
|---|---|---|
| Google Gemini 3.1 Flash-Lite | 0.125 / 0.75 | **0.32** |
| OpenAI gpt-5.4-nano | 0.20 / 1.25 | **0.52** |
| Anthropic Claude Haiku 4.5 | 1 / 5 | **2.47** |
| OpenAI gpt-5.6-luna | 1 / 6 | **2.57** |
| Google Gemini 3.5 Flash | 1.50 / 9 | **3.85** |
| Anthropic Claude Sonnet 5 | 2 / 10 (promotional, through 31 Aug 2026) | **4.94** |
| OpenAI gpt-5.6-terra | 2.50 / 15 | **6.41** |
| Anthropic Claude Sonnet 5 | 3 / 15 (standard, from 1 Sep 2026) | **7.40** |
| Anthropic Claude Opus 5 | 5 / 25 | **12.34** |
| OpenAI gpt-5.6-sol | 5 / 30 | **12.83** |
| Ollama, self-hosted | 0 marginal | **0** in tokens, see below |

Two levers cut those further. Anthropic's Batch API halves both input and output
for a 24-hour turnaround, which a Monday 06:00 brief tolerates perfectly, taking
Sonnet 5 to about 2.47. Prompt caching does not help much here and it is worth
saying so: only about 1,600 tokens of the 30,000 are static, so caching the rules
block saves pennies. The fact sheet is the cost and it is different every week.

**Range across the entire viable field: 32 cents to 13 dollars a month.** For a
weekly executive brief, a mid-tier model is the right choice and the whole line
item is under 8 dollars.

### The Ollama arithmetic, honestly

Self-hosted inference has no per-token cost and a large fixed cost. A workstation
capable of running a 70B-class model at usable speed is somewhere between 8,000
and 20,000 dollars, or roughly 220 to 550 dollars a month amortised over three
years, before power and before anyone's time. Against a 5 dollar API bill that is
a terrible trade on cost alone.

It is a good trade when the hardware already exists for another purpose, when
volume is high enough to cross over (the break-even against Sonnet 5 at these
token counts is somewhere north of 2,000 briefs a month), or when the governance
requirement is absolute and the cost is simply the price of it. Say which of
those applies before buying a GPU.

### The comparison to a vendor

Rival IQ does not publish a price for an AI briefing feature, so I am not going
to invent one and claim it as a fact. What can be said precisely:

Rival IQ's Engage Pro plan is 559 dollars a month for 40 tracked companies, 24
months of history and 5 user accounts, with additional users at 10 dollars a
month (their published pricing page, verified July 2026). If an AI brief feature
were added and priced the way the market prices AI add-ons, at 20 to 30 dollars
per seat, five seats is 100 to 150 dollars a month. Ten seats is 200 to 300.

The same output, on the same schedule, on a mid-tier frontier model, costs
between 2.47 and 7.40 dollars a month in tokens, and does not change when the
sixth or the twentieth person starts reading it.

**That is roughly a 20x to 60x spread, and the direction of the error is
one-way**: the vendor number grows with adoption and the token number does not.
This is a hypothetical about vendor pricing and it is labelled as one. The
non-hypothetical part is the left-hand column, which comes from published list
prices and an arithmetic you can check.

---

## 4. Model portability

New models ship on a Tuesday. In 2026 the interval between a materially better
model becoming available and it being worth switching to is measured in weeks.

In Data Dumpster, switching is a text field. A model connection stores a provider, a
free-text model id, and optional prices. The suggested models in the picker are
suggestions; anything the provider accepts works, including a model released
after this code was written. Nothing in the application hard-codes a model name.
The default connection can be swapped without touching a deployment.

That matters in three directions.

**Upward.** A brief that is not quite good enough on a mid-tier model can be run
on a frontier model for the difference between 5 and 13 dollars a month. That is
an experiment, not a procurement decision.

**Downward.** Once the fact sheet and verification architecture are doing the
work, a much cheaper model may be sufficient, because the model is narrating
verified numbers rather than reasoning about them. The tagging prompt already
runs at temperature 0 against a closed JSON Schema, which is the kind of task
small models do well. Testing whether Haiku or Flash-Lite is good enough for
tagging is a settings change and a comparison, and it is worth about a 5x cost
difference.

**Sideways.** If a provider has an outage, changes its terms, or is acquired,
Data Dumpster keeps working against a different one. With a hosted-model SaaS, the
vendor's model choice is your model choice, including their outages.

The seam that makes this real is in "src/lib/ai/registry.ts". PROVIDERS is a
complete Record over the ModelProviderId union, so TypeScript fails the build the
moment an id is added without an implementation. Adding a provider is one file
and one line, and the Settings picker renders straight off listProviders() with
no UI work.

---

## 5. Why the output is trustworthy enough to send to an executive

This is the part that makes bring-your-own-model more than a procurement
preference. A cost argument does not matter if the output cannot be used.

The architecture has three pieces and the order is the product.

### One: the model never touches data

"getFactSheet()" in "src/lib/metrics/queries.ts" runs nine parallel SQL
aggregations and returns a typed FactSheet: leaderboards for every headline
metric, the focus company summary with previous-period values, the ten top posts,
tag and post-type performance, notable URLs, machine-detected anomalies with
z-scores, and a list of caveats the data itself generated.

The model receives that object plus a flat index of every number in it with the
exact path that number lives at. It has no database access, no tools, and no
search. The prompt says: you may state a number only if that exact number appears
in the fact sheet; you may not add, subtract, multiply, divide, average, rank,
project, or annualise; if the sheet lacks a figure you want, write the sentence
without a figure.

It is not being asked to be honest. It is structurally unable to compute.

### Two: verification is deterministic, and it is not a model

"src/lib/ai/verify.ts" is 342 lines of string and number handling with no model
call in it. This is what it actually does.

**It splits the brief into sentences** on the original text, so that bracketed
citations stay attached to the sentence they qualify.

**It strips everything containing digits that is not a quantitative claim**
before parsing: fact-sheet citations themselves, markdown links and image URLs,
fenced and inline code, ISO dates, bare years, clock times, and calendar dates
written in prose ("July 18", "18 July", "Sept. 3rd"). A day of the month is a
location in time, not a measurement, and a checker that flags it is a checker
people learn to ignore.

**It extracts every remaining number as people actually write them**: 41,208 /
1.2M / 45k / 27.3% / $3.40 / -12.5 / 2.3 million.

**It derives tolerance from written precision.** This is the rule that makes the
whole thing defensible. Someone who writes "1.2M" has claimed the value lies in
[1.15M, 1.25M] and nothing more, so the tolerance is half a unit in the last
written place. 1.2M is allowed to be 1,234,567. It is not allowed to be 900,000.

**It matches each number against an index of every number in the fact sheet**,
built by walking the object and recording each finite number with its path.
Percentages are tried both as written and as a fraction, because fact sheets
store 0.27 and prose says 27 percent.

**It flags three classes of failure separately**, which matters because they mean
different things:
- *unverified*: the number does not appear in the fact sheet at all. The report
  includes the nearest fact-sheet value and its path, so a human can see the miss.
- *miscited*: the number is real but the bracketed path points somewhere else.
  The figure is right and the provenance is wrong, and an editor tracing the claim
  would be misled. This is the subtle one and it is caught.
- *violations*: rule breaches that are not about grounding. An uncited figure. A
  printed percent change above 1000 percent, which is always a near-zero baseline
  artefact and is exactly the failure mode that produces "engagement up
  265,895.2%" in commercial social tools.

**It checks caveat coverage by distinctive-word overlap.** Caveats rarely survive
verbatim, because the model is told to reword them into the sentence they
qualify, which is right for a reader and inconvenient for a checker. So coverage
is measured as the fraction of load-bearing words present, with a 60 percent
threshold. A dropped caveat is a rule violation.

**It never throws.** A verification pass that can fail is a verification pass that
gets caught and ignored at the call site. This one always returns a verdict, and
an unparseable brief simply has no grounded claims.

One deliberate subtlety: a number the model copied out of a caveat is not a claim
it made, it is a caveat it was required to restate. Those are grounded against the
caveat itself rather than demanding a citation the prompt never asked for.

### Three: one repair turn, then the verdict ships with the document

If verification fails, "src/lib/ai/brief.ts" sends one correction turn listing the
exact failing strings and the paths that were available, because "your numbers
were wrong, try again" reliably produces a differently wrong document. Then it
keeps whichever draft scored higher and stops. One pass, not a loop: a model that
cannot ground its claims on the second attempt will not on the fifth, and each
attempt costs the org money.

The brief row then stores the markdown, the exact fact sheet the model saw, the
verification verdict, the model and provider used, the cost, the latency, and
whether it was repaired, all in one jsonb column. A brief without its fact sheet
is an assertion. With it, it is a document someone can audit a year later.

When verification fails on both passes, the brief is still stored and the UI
renders the verification panel listing every ungrounded claim. Nothing ships
silently.

### Why this matters more than the model choice

The reason an executive can trust a Data Dumpster brief is not that it was written by a
good model. It is that the numbers came from SQL, the model was only allowed to
narrate them, and a deterministic checker verified the narration. That is why
running the whole thing on a cheap model, or on a model inside the building, is a
real option rather than a compromise. The guardrails do not get weaker when the
model does.

It is also the reason to be skeptical of an AI feature in a competitive analytics
product that cannot show you the fact sheet. Ask any vendor selling AI social
summaries what happens when the model states a number that is not in the data.
The answer should be a mechanism, not a policy.
