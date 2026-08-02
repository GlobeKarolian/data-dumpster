# Rival IQ parity contract

This is the implementation checklist for matching the Rival IQ surfaces captured
on 29 July 2026, then exceeding them where Data Dumpster has a stronger data or
product model. The screenshots and `docs/RIVALIQ-TEARDOWN.md` are the reference.

## Release gate

A capability is only marked complete when:

1. The visible control works end to end with real warehouse data.
2. Every filter shown in the URL changes every affected query.
3. An export names its scope, date window and metric definitions.
4. Empty history stays blank instead of being replaced with invented change.
5. Audience uses the latest snapshot per channel, never a sum of snapshots.
6. A zero comparison baseline produces no percentage.
7. Any AI-written number is present in, and verified against, its code-generated
   fact sheet.

## Match

| Area | Rival IQ capability | Data Dumpster acceptance test | Status |
|---|---|---|---|
| Cross-channel | Audience, activity, engagement and component metrics | Current and prior windows, company and platform filters, complete landscape rows | Complete |
| Leaderboard | Audience, net change, posts, engagement, per-post, applause, conversation, amplification | Full landscape, platform composition, current/prior delta, honest blanks | Complete |
| Social posts | Ranked posts plus channel, type, time, hashtag and topic breakdowns | One post explorer with the same active filters and CSV export | Core parity complete; advanced tags pending |
| Platform views | Platform-native overview and leaderboard language | TikTok says videos, YouTube says videos, X naming is consistent | Complete |
| Dashboards | Focus and landscape charts, tables, scatter, at-a-glance and social posts | Create, edit, reorder, share and export a saved dashboard | In progress |
| Reports | On-demand PowerPoint and CSV | Files open cleanly and contain the report's exact computed values | Complete |
| Scheduled exports | Weekly PowerPoint and CSV delivered by email | Admin can schedule, run now, disable and inspect last result | Complete in code |
| Alerts | Configured rules, evidence feed and delivery | A detected move opens the exact posts behind it and can be delivered on schedule | In progress |
| Tags and URLs | Post tags, rules and URL analysis | Company-correct tag lift plus URL reuse, domain, owned/curated and export views | In progress |

## Exceed

| Advantage | Acceptance test | Status |
|---|---|---|
| Story Cloud | Story clusters remain linked to source posts and filters | Complete |
| Verified AI briefs | No unverified numeric statement can render | Complete |
| Bring your own model | Provider choice, metering and failure states remain visible | Complete |
| Transparent metrics | Definitions and caveats are visible next to results | Complete |
| Safer change math | Zero baselines and missing audience history stay blank | Complete |
| Broader public channels | Threads and Bluesky remain first-class filters | Complete |

## Deliberate boundaries

- Crons remain undeclared in `vercel.json` until vendor spend is approved. The
  scheduled-export endpoint can be invoked manually and is ready to attach later.
- Social listening, account discovery and private owned-channel insights are
  separate data products. They require an approved vendor or owned credentials,
  not placeholder screens.
- The app does not ingest RSS and does not publish social posts.

## Live interaction findings

The signed-in product was exercised on 29 July 2026, including filters,
drill-downs, layouts, dashboard editing, alert evidence, company profiles and
report delivery. Rival IQ's interaction model is consistent:

1. Landscape, company set and date are global state. A content search or URL
   filter recalculates the headline, insight copy and every table below it.
2. Dense overview screens use progressive disclosure. `View More` isolates a
   widget; a company row expands into the underlying URLs; an alert opens the
   exact posts that caused the movement.
3. The post library separates data from presentation. The same result can be a
   table, media grid or mosaic, with independent sort and column choices.
4. Dashboard configuration is a full live-preview workflow. A widget selects
   type, series, comparison, grouping, width and title before it is saved.
5. Delivery is part of the product, not an afterthought. Reports can be emailed
   immediately or scheduled daily, weekly, bi-weekly or monthly with a delivery
   hour, company set, focus company and channel selection.

The product is broad but often noisy. It will display huge changes on tiny
baselines, and its owned/curated URL classification can produce obviously
misleading rows when a company's configured site does not match the domains it
publishes. Data Dumpster should copy the evidence chain and delivery workflow,
not those failure modes.

## Next build order

1. **Post library tagging:** add tagged/untagged, include/exclude and AND/OR tag
   facets, then bulk and inline tag assignment. URL/content search,
   list/details/mosaic layouts, configurable honest-data columns, at-a-glance,
   activity, topics, hashtags, channel/type mix and Boston-time publishing
   analysis now share one filter contract on `/posts`.
2. **Evidence-first alerts:** every outlier or movement opens the posts, URLs or
   audience readings that produced it. Use the existing safer baseline rules.
3. **Posted URL intelligence:** unique URL count, reuse rate, owned/curated
   classification with editable domain aliases, domain drill-down and CSV.
4. **Dashboard export:** export one widget as CSV/PNG and a saved dashboard as a
   PowerPoint. Reuse the verified report export path.
5. **Morning Radar:** combine Story Cloud, outliers and coverage gaps into a
   short desk-ready queue: what moved, why it matters, evidence and the next
   editorial decision.
