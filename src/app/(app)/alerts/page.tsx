import type { Metadata } from 'next';
import { Activity } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/components/ui/format';
import { NoLandscape } from '@/components/common/no-landscape';
import { AlertRules, type AlertRuleRecord, type AlertKind } from '@/components/alerts/alert-rules';
import { resolveContext } from '../_lib/context';
import { query, type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Alerts' };

type RuleRow = {
  id: string;
  name: string;
  kind: AlertKind;
  enabled: boolean;
  last_fired_at: string | null;
  config: AlertRuleRecord['config'];
  destinations: { type?: string }[];
  event_count: number | string;
};

type EventRow = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  created_at: string;
  acknowledged_at: string | null;
  rule_name: string;
};

const SEVERITY_TONE: Record<string, 'neutral' | 'warning' | 'critical'> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'critical',
};

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const orgId = ctx.orgId;
  const automationEnabled = process.env.AUTOMATION_DISPATCHER_ENABLED === 'true';
  const [rules, events] = await Promise.all([
    query<RuleRow>(({ sql }) => sql`
      SELECT r.id, r.name, r.kind, r.enabled, r.last_fired_at, r.config, r.destinations,
             count(e.id) AS event_count
        FROM alert_rules r
        LEFT JOIN alert_events e ON e.rule_id = r.id
       WHERE r.org_id = ${orgId}::uuid
         AND (
           ${ctx.role === 'admin' || ctx.role === 'owner'}
           OR r.landscape_id IS NULL
           OR EXISTS (
             SELECT 1
               FROM user_landscape_access ula
              WHERE ula.landscape_id = r.landscape_id
                AND ula.user_id = ${ctx.userId}::uuid
           )
         )
       GROUP BY r.id
       ORDER BY r.created_at DESC
    `),
    query<EventRow>(({ sql }) => sql`
      SELECT e.id, e.title, e.body, e.severity, e.created_at, e.acknowledged_at,
             r.name AS rule_name
        FROM alert_events e
        JOIN alert_rules r ON r.id = e.rule_id
       WHERE e.org_id = ${orgId}::uuid
         AND (
           ${ctx.role === 'admin' || ctx.role === 'owner'}
           OR r.landscape_id IS NULL
           OR EXISTS (
             SELECT 1
               FROM user_landscape_access ula
              WHERE ula.landscape_id = r.landscape_id
                AND ula.user_id = ${ctx.userId}::uuid
           )
         )
       ORDER BY e.created_at DESC
       LIMIT 50
    `),
  ]);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div>
        <AlertRules
          landscapeId={ctx.landscape.id}
          automationEnabled={automationEnabled}
          rules={rules.data.map((r) => ({
            id: r.id,
            name: r.name,
            kind: r.kind,
            enabled: r.enabled,
            lastFiredAt: r.last_fired_at,
            eventCount: Number(r.event_count) || 0,
            config: r.config ?? {},
            // Only the destination KIND crosses to the browser. A Slack webhook
            // URL is a bearer credential -- anyone holding it can post into the
            // newsroom's channel -- and this list is rendered by a Client
            // Component, so anything left on the object is serialized into the
            // RSC payload and readable by every signed-in user, viewers included.
            destinations: Array.isArray(r.destinations)
              ? r.destinations.map((d) => ({ type: d?.type }))
              : [],
          }))}
        />
        {rules.error ? (
          <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
            {'Rules could not be read: ' + rules.error}
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Event feed</CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Everything the rules have raised, newest first.
            </p>
          </div>
        </CardHeader>
        {events.data.length === 0 ? (
          <EmptyState
            compact
            icon={Activity}
            title="Nothing has fired yet"
            description={automationEnabled
              ? 'Rules are evaluated on a schedule. An empty feed means either the rules are new or the landscape has been quiet.'
              : 'Automatic evaluation is currently paused. Saved rules will not fire until the dispatcher is enabled.'}
          />
        ) : (
          <ul className="max-h-[36rem] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800/60">
            {events.data.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{e.title}</p>
                    {e.body ? (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                        {e.body}
                      </p>
                    ) : null}
                    <p className="pb-num mt-1 text-[11px] text-zinc-400">
                      {e.rule_name + ' · ' + formatDateTime(e.created_at)}
                    </p>
                  </div>
                  <Badge tone={SEVERITY_TONE[e.severity] ?? 'neutral'}>{e.severity}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
        {events.error ? (
          <p className="border-t border-zinc-200 px-4 py-2 text-[11px] text-red-600 dark:border-zinc-800 dark:text-red-400">
            {'Event feed could not be read: ' + events.error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
