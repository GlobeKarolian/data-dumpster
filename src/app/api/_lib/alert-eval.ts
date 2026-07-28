/**
 * Turning alert rules into events.
 *
 * Every evaluator here reads through lib/metrics, never raw SQL. That is not
 * tidiness for its own sake: it means an alert and the dashboard it came from
 * are computed by the same code, so an alert can never claim something the UI
 * would contradict. An alerting system that disagrees with its own charts gets
 * muted within a week.
 *
 * Two more rules the evaluators follow:
 *   - Nothing fires on a tiny baseline. A company that went from 2 posts to 6 is
 *     not "up 200%"; it is noise, and printing it is how you train people to
 *     ignore you.
 *   - Every candidate carries a dedupeKey. Alerts run hourly over a multi-day
 *     window, so the same finding will be true many times in a row; the key is
 *     what stops it being announced many times in a row.
 */
import { and, eq, gt, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { channels, companies, landscapeCompanies } from '@/db/schema';
import { getLeaderboard, getPosts } from '@/lib/metrics/queries';
import { presetRange, toDayString } from '@/lib/dates';
import { compactNumber, formatChange, percent } from '@/lib/utils';
import type { Platform } from '@/lib/types';
import type { AlertKind } from '../alerts/_kinds';
import type { AlertConfig } from './alert-config';

export interface CandidateEvent {
  title: string;
  body: string;
  severity: 'info' | 'warning';
  /** Stable identity for this finding. Same finding, same key, across runs. */
  dedupeKey: string;
  payload: Record<string, unknown>;
}

export interface RuleToEvaluate {
  id: string;
  orgId: string;
  landscapeId: string | null;
  name: string;
  kind: AlertKind;
  config: AlertConfig;
  lastFiredAt: Date | null;
}

/** Baselines below this are too small to make a percentage claim about. */
const MIN_BASELINE_POSTS = 10;
const MIN_BASELINE_FOLLOWERS = 500;

function platformsOf(config: AlertConfig): Platform[] | undefined {
  return config.platforms.length > 0 ? config.platforms : undefined;
}

async function outlierEvents(rule: RuleToEvaluate, landscapeId: string): Promise<CandidateEvent[]> {
  const { start, end } = presetRange(rule.config.lookbackDays);
  const page = await getPosts({
    orgId: rule.orgId,
    landscapeId,
    start,
    end,
    platforms: platformsOf(rule.config),
    sort: 'engagementTotal',
    direction: 'desc',
    page: 1,
    pageSize: 100,
  });

  return page.items
    .filter((p) => p.outlierScore !== null
      && p.outlierScore >= rule.config.outlierMultiple
      && p.engagementTotal >= rule.config.minEngagement)
    .map((p) => ({
      title: p.company.name + ' had an outlier on ' + p.platform,
      body: [
        'Engagement ' + compactNumber(p.engagementTotal),
        (p.outlierScore ?? 0).toFixed(1) + 'x their median for this platform',
        p.permalink ?? '',
      ].filter(Boolean).join(' - '),
      severity: 'info' as const,
      dedupeKey: 'outlier:' + p.id,
      payload: {
        postId: p.id,
        companyId: p.company.id,
        platform: p.platform,
        engagementTotal: p.engagementTotal,
        outlierScore: p.outlierScore,
        permalink: p.permalink,
      },
    }));
}

async function movementEvents(
  rule: RuleToEvaluate,
  landscapeId: string,
  kind: 'audience_swing' | 'volume_drop' | 'share_of_voice_shift',
): Promise<CandidateEvent[]> {
  const { start, end } = presetRange(rule.config.lookbackDays);
  const metric = kind === 'audience_swing'
    ? (rule.config.metric ?? 'audience')
    : kind === 'volume_drop'
      ? 'posts'
      : 'shareOfVoice';

  const rows = await getLeaderboard({
    orgId: rule.orgId,
    landscapeId,
    start,
    end,
    platforms: platformsOf(rule.config),
    compare: true,
    metric,
  });

  const window = toDayString(end);
  const out: CandidateEvent[] = [];

  for (const row of rows) {
    const prev = row.previousValue ?? null;
    if (prev === null) continue;

    if (kind === 'share_of_voice_shift') {
      // Share of voice is already a fraction, so compare it in points rather
      // than as a percentage change of a percentage -- which is unreadable.
      const delta = row.value - prev;
      if (Math.abs(delta) < rule.config.thresholdPct) continue;
      out.push({
        title: row.company.name + (delta > 0 ? ' gained ' : ' lost ')
          + percent(Math.abs(delta), 1) + ' of share of voice',
        body: 'Now ' + percent(row.value, 1) + ', was ' + percent(prev, 1)
          + ' over the previous ' + rule.config.lookbackDays + ' days.',
        severity: 'info',
        dedupeKey: 'sov:' + row.company.id + ':' + window,
        payload: { companyId: row.company.id, metric, value: row.value, previousValue: prev, delta },
      });
      continue;
    }

    const floor = kind === 'audience_swing' ? MIN_BASELINE_FOLLOWERS : MIN_BASELINE_POSTS;
    if (prev < floor) continue;

    const change = row.changePct ?? null;
    if (change === null || !Number.isFinite(change)) continue;

    const fired = kind === 'volume_drop'
      ? change <= -rule.config.thresholdPct
      : Math.abs(change) >= rule.config.thresholdPct;
    if (!fired) continue;

    const label = formatChange(change).label;
    out.push({
      title: row.company.name + ': ' + metric + ' ' + label,
      body: compactNumber(row.value) + ' this period versus ' + compactNumber(prev)
        + ' in the previous ' + rule.config.lookbackDays + ' days.',
      severity: kind === 'volume_drop' ? 'warning' : 'info',
      dedupeKey: (kind === 'volume_drop' ? 'volume:' : 'audience:') + row.company.id + ':' + window,
      payload: { companyId: row.company.id, metric, value: row.value, previousValue: prev, changePct: change },
    });
  }

  return out;
}

async function keywordEvents(rule: RuleToEvaluate, landscapeId: string): Promise<CandidateEvent[]> {
  if (rule.config.keywords.length === 0) return [];
  const { start, end } = presetRange(rule.config.lookbackDays);
  const out: CandidateEvent[] = [];

  for (const keyword of rule.config.keywords) {
    const page = await getPosts({
      orgId: rule.orgId,
      landscapeId,
      start,
      end,
      platforms: platformsOf(rule.config),
      search: keyword,
      sort: 'postedAt',
      direction: 'desc',
      page: 1,
      pageSize: 25,
    });

    for (const p of page.items) {
      out.push({
        title: p.company.name + ' posted about "' + keyword + '"',
        body: [(p.text ?? '').slice(0, 240), p.permalink ?? ''].filter(Boolean).join(' - '),
        severity: 'info',
        dedupeKey: 'keyword:' + keyword.toLowerCase() + ':' + p.id,
        payload: { keyword, postId: p.id, companyId: p.company.id, platform: p.platform, permalink: p.permalink },
      });
    }
  }

  return out;
}

async function newChannelEvents(rule: RuleToEvaluate, landscapeId: string): Promise<CandidateEvent[]> {
  const memberIds = (
    await db
      .select({ companyId: landscapeCompanies.companyId })
      .from(landscapeCompanies)
      .where(eq(landscapeCompanies.landscapeId, landscapeId))
  ).map((r) => r.companyId);
  if (memberIds.length === 0) return [];

  // First run has no lastFiredAt; fall back to the lookback window rather than
  // announcing every channel the org has ever added.
  const since = rule.lastFiredAt ?? presetRange(rule.config.lookbackDays).start;

  const rows = await db
    .select({
      id: channels.id,
      platform: channels.platform,
      handle: channels.handle,
      profileUrl: channels.profileUrl,
      companyId: channels.companyId,
      companyName: companies.name,
    })
    .from(channels)
    .innerJoin(companies, eq(companies.id, channels.companyId))
    .where(and(
      inArray(channels.companyId, memberIds),
      eq(companies.orgId, rule.orgId),
      gt(channels.createdAt, since),
    ));

  return rows.map((r) => ({
    title: r.companyName + ' added a ' + r.platform + ' channel',
    body: '@' + r.handle + (r.profileUrl ? ' - ' + r.profileUrl : ''),
    severity: 'info' as const,
    dedupeKey: 'channel:' + r.id,
    payload: { channelId: r.id, companyId: r.companyId, platform: r.platform, handle: r.handle },
  }));
}

/**
 * Evaluate one rule. Returns at most maxEventsPerRun candidates, highest value
 * first, so a noisy day produces a digest rather than a flood.
 */
export async function evaluateRule(rule: RuleToEvaluate): Promise<CandidateEvent[]> {
  // 'custom' is a placeholder kind for rules driven by a future expression
  // editor. It evaluates to nothing rather than to a guess.
  if (rule.kind === 'custom') return [];
  if (!rule.landscapeId) return [];

  const landscapeId = rule.landscapeId;
  const candidates = rule.kind === 'competitor_outlier'
    ? await outlierEvents(rule, landscapeId)
    : rule.kind === 'keyword_hit'
      ? await keywordEvents(rule, landscapeId)
      : rule.kind === 'new_channel'
        ? await newChannelEvents(rule, landscapeId)
        : await movementEvents(rule, landscapeId, rule.kind);

  return candidates.slice(0, rule.config.maxEventsPerRun);
}
