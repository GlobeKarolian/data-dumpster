# Data pooling

## The insight this is copied from

Rival IQ's help documentation contains one sentence that explains their entire
cost structure:

> The start date for public data from a particular channel is the day a company
> was first added to Rival IQ by a customer. Rival IQ accumulates data for that
> company from that date moving forward and **this data is accessible by all
> customers**.

Collect The Boston Globe's TikTok once, serve it to every customer who tracks
The Boston Globe. Their marginal cost of the two-thousandth customer adding a
company someone already tracks is zero, and the depth of history a new customer
inherits on day one is years rather than days.

That is why a $239 a month subscription can profitably cover twenty-two
companies across five platforms, and it is the specific mechanism our own
build-versus-buy memo could not answer.

## Why this is not merely a nice optimisation

Public social data has a property that makes pooling not just possible but
obviously correct: **it is identical regardless of who is looking.** The Boston
Globe's TikTok post has one view count. Two organisations tracking it do not
have different views of it. Storing it twice is not isolation, it is waste.

Compare with the things that genuinely are tenant-specific: which companies you
consider rivals, what you tag a post, what your dashboard looks like, what your
brief says. Those differ per organisation and must stay separated.

So the correct boundary is not "org owns everything". It is:

    SHARED, collected once, read by everyone
      companies          an outlet that exists in the world
      channels           that outlet's account on a platform
      posts              what that account published
      audience_snapshots how many followers it had, by day
      posted_urls        what it linked to

    PRIVATE, per organisation
      landscapes         which outlets you consider your market
      post_tags          your taxonomy, your desks, your rules
      dashboards         your saved views
      briefs, reports    your analysis and your commentary
      alert_rules        what you want to be told about
      model_connections  your inference, your keys, your spend

## What this changes for Boston Globe Media

**Within the Globe, immediately.** Ten companies already sit in both the BGM and
Boston News Market landscapes. Those are collected once today because companies
are shared across landscapes, which is 51 of 138 channels already amortised. The
saving is real but bounded, because one organisation only has so many
landscapes.

**Across organisations, which is the actual prize.** Every metro daily in the
country tracks a landscape that overlaps with somebody else's. The Star Tribune
tracks its market. The Inquirer, through Lenfest, tracks its own. All of them
track the national wires, the networks and each other. If those landscapes lived
in one pooled collection layer, the marginal cost of a shared company falls to
zero and the history everyone inherits is however long the earliest subscriber
has been collecting.

This is the difference between an internal tool that costs Globe Media $400 a
month in vendor fees and a piece of shared infrastructure whose cost per
participating newsroom falls as more newsrooms join.

## What it does to the build-versus-buy argument

`docs/BUILD-VS-BUY.md` concludes that buying wins on cost: roughly $609 a month
bought against $1,925 to $3,365 a month built, once engineering time is counted.

That conclusion holds for a single tenant, and pooling is the only thing that
changes it. Rival IQ is not cheaper because they write better code. They are
cheaper because their collection cost is divided across their entire customer
base and ours is divided by one.

Any honest pitch has to say this plainly: **the way to beat the incumbent on
cost is to copy the mechanism that makes them cheap, not to out-engineer them.**

## Architecture

Companies, channels and their data become globally shared rather than owned by
an organisation. Identity is the channel, not the name: an outlet is whatever
publishes at a given platform and handle, so two organisations adding
`tiktok/@bostonglobe` resolve to one channel and one collection schedule.

Organisations reference shared companies through landscapes, which stay private.
Naming stays shared too, because "The Boston Globe" is not a matter of opinion,
but a later per-org override table is the obvious extension if it ever is.

Ingestion becomes: collect every active channel once, regardless of how many
organisations or landscapes point at it. That is already how the runner behaves
per channel; the change is that channel uniqueness becomes global.
