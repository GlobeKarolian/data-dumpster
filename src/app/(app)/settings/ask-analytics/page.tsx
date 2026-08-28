import type { Metadata } from 'next';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AskAnalyticsPanel, type AskOutcomeRow, type AskRecentRow, type UsageEventRow } from '@/components/settings/ask-analytics-panel';
import { query, type SearchParamsInput } from '../../_lib/data';

export const metadata: Metadata = { title: 'Ask Analytics' };

type OutcomeQueryRow = {
  outcome: string;
  calls: number | string;
  cost_usd: number | string;
  input_tokens: number | string;
  output_tokens: number | string;
};

type RecentQueryRow = {
  id: string;
  question: string;
  outcome: string;
  model: string | null;
  cost_usd: number | string | null;
  latency_ms: number | string | null;
  created_at: string;
};

type EventQueryRow = {
  surface: string;
  action: string;
  events: number | string;
  last_at: string;
};

/**
 * Ask (Alpha) analytics.
 *
 * Internal view of how the Alpha assistant is being used and how often the
 * verifier has to rescue or reject it. This is the feedback loop the Alpha
 * banner promises: every interaction is logged, and this is where those logs
 * become a reason to tighten a prompt or the verifier. Admin-only because it
 * shows raw questions, which reveal what the newsroom is watching.
 */
export default async function AskAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  await searchParams;
  const { requireRole } = await import('@/lib/session');
  const { orgId } = await requireRole('admin');

  const [outcomes, recent, events] = await Promise.all([
    query<OutcomeQueryRow>(({ sql }) => sql`
      SELECT outcome,
             count(*) AS calls,
             coalesce(sum(cost_usd), 0) AS cost_usd,
             coalesce(sum(input_tokens), 0) AS input_tokens,
             coalesce(sum(output_tokens), 0) AS output_tokens
        FROM ask_interactions
       WHERE org_id = ${orgId}::uuid
       GROUP BY outcome
       ORDER BY count(*) DESC
    `),
    query<RecentQueryRow>(({ sql }) => sql`
      SELECT id, question, outcome, model, cost_usd, latency_ms, created_at
        FROM ask_interactions
       WHERE org_id = ${orgId}::uuid
       ORDER BY created_at DESC
       LIMIT 50
    `),
    query<EventQueryRow>(({ sql }) => sql`
      SELECT surface, action, count(*) AS events, max(created_at) AS last_at
        FROM analytics_events
       WHERE org_id = ${orgId}::uuid
       GROUP BY surface, action
       ORDER BY count(*) DESC
    `),
  ]);

  const outcomeRows: AskOutcomeRow[] = outcomes.data.map((r) => ({
    outcome: r.outcome,
    calls: Number(r.calls) || 0,
    costUsd: Number(r.cost_usd) || 0,
    inputTokens: Number(r.input_tokens) || 0,
    outputTokens: Number(r.output_tokens) || 0,
  }));

  const recentRows: AskRecentRow[] = recent.data.map((r) => ({
    id: r.id,
    question: r.question,
    outcome: r.outcome,
    model: r.model,
    costUsd: r.cost_usd === null ? null : Number(r.cost_usd) || 0,
    latencyMs: r.latency_ms === null ? null : Number(r.latency_ms) || 0,
    createdAt: r.created_at,
  }));

  const eventRows: UsageEventRow[] = events.data.map((r) => ({
    surface: r.surface,
    action: r.action,
    events: Number(r.events) || 0,
    lastAt: r.last_at,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="text-base">Ask (Alpha) analytics</CardTitle>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              How the Alpha assistant is being used, and how often deterministic verification has
              to repair or reject what it writes. A rising <em>repaired</em> or <em>rejected</em>
              count is a prompt or verifier problem to fix, not a user problem to explain away.
            </p>
          </div>
        </CardHeader>
      </Card>

      {outcomes.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {'Ask analytics could not be read: ' + outcomes.error}
        </p>
      ) : null}

      <AskAnalyticsPanel outcomes={outcomeRows} recent={recentRows} events={eventRows} />
    </div>
  );
}
