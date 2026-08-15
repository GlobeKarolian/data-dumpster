# 2028 Presidential Tracker

The Election Center's national tracker is backed by a private landscape and the
same pooled company, channel, post, audience-snapshot, and metric tables as the
rest of Data Dumpster. The live route is `/elections/2028-presidential-watchlist`;
the older `/elections/2028` concept route permanently redirects there.

## Source roster

The initial roster came from the newsroom-provided account audit dated
2026-08-14. It contains 20 prospective candidates: ten Democrats and ten
Republicans. Inclusion is a watchlist decision, not evidence that someone has
declared or will run.

The import contains 107 verified or likely candidate-controlled accounts across
X, Instagram, Facebook, TikTok, YouTube, Bluesky, and Truth Social. It keeps
multiple legitimate accounts on the same platform when the audit identifies a
separate campaign and government or congressional presence. Linktree, Substack,
Twitch, and Rumble entries are not social-measurement sources in Data Dumpster
and were not imported. Accounts marked `none_found` or `exists_unconfirmed`
were also excluded. JD Vance's Bluesky mirror was excluded because the audit
says it is not confirmed as an official candidate-controlled profile.

Government and congressional accounts are allowed in this watchlist only where
the audit selected them as the person's primary active presence on that
platform. Every such source carries an explicit note in the admin diagnostics.
The public analytics surfaces also say that the tracker is not polling.

## Display and collection

- Rankings are always computed from the selected metric and sort highest to
  lowest; the spreadsheet's editorial watchlist rank is not used as a
  performance score.
- The momentum chart shows the top ten candidates by engagement when the field
  is larger than ten, keeping the national view readable.
- The shared profile pool prevents duplicate crawls if a candidate is later
  added to another race.
- Pending sources connect automatically in bounded batches and then enter the
  normal durable collection queue.
