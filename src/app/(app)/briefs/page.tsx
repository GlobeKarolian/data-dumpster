import type { Metadata } from 'next';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { toDayString } from '@/lib/dates';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatFullDate, formatRelative } from '@/components/ui/format';
import { NoLandscape } from '@/components/common/no-landscape';
import { GenerateBriefButton } from '@/components/briefs/generate-brief-button';
import { resolveContext } from '../_lib/context';
import { query, type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Briefs' };

type BriefRow = {
  id: string;
  title: string;
  period_start: string;
  period_end: string;
  model_used: string | null;
  created_at: string;
  verified_ok: string | null;
  claim_total: string | null;
};

export default async function BriefsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const landscapeId = ctx.landscape.id;
  const briefs = await query<BriefRow>(({ sql }) => sql`
    SELECT b.id, b.title, b.period_start, b.period_end, b.model_used, b.created_at,
           b.facts -> 'verification' ->> 'ok' AS verified_ok,
           b.facts -> 'verification' -> 'stats' ->> 'total' AS claim_total
      FROM briefs b
     WHERE b.org_id = ${ctx.orgId}::uuid
       AND b.landscape_id = ${landscapeId}::uuid
     ORDER BY b.period_end DESC, b.created_at DESC
     LIMIT 60
  `);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Written briefs
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            A brief is prose over a fact sheet that was computed first. The model is never allowed to
            query; it may only narrate numbers that were already verified. Every claim it makes is
            then checked back against that sheet, mechanically, and the result is stored with the
            brief.
          </p>
        </div>
        <GenerateBriefButton
          landscapeId={ctx.landscape.id}
          start={toDayString(ctx.range.start)}
          end={toDayString(ctx.range.end)}
        />
      </div>

      {briefs.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {'Briefs could not be listed: ' + briefs.error}
        </p>
      ) : null}

      {briefs.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="No briefs yet"
            description="Generate one for the window in the top bar. It takes as long as your model takes, and nothing is sent anywhere except the endpoint you configured."
            secondaryAction={{ label: 'Check model connection', href: '/settings/models' }}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{briefs.data.length + (briefs.data.length === 1 ? ' brief' : ' briefs')}</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {briefs.data.map((b) => {
              const verified = b.verified_ok === 'true';
              const claims = Number(b.claim_total ?? '0') || 0;
              return (
                <li key={b.id}>
                  <Link
                    href={'/briefs/' + b.id}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {b.title}
                      </p>
                      <p className="pb-num mt-0.5 text-[11px] text-zinc-500">
                        {formatFullDate(b.period_start) +
                          ' – ' +
                          formatFullDate(b.period_end) +
                          ' · written ' +
                          formatRelative(b.created_at) +
                          (b.model_used ? ' · ' + b.model_used : '')}
                      </p>
                    </div>
                    {b.verified_ok === null ? (
                      <Badge tone="neutral">Unverified</Badge>
                    ) : verified ? (
                      <Badge tone="positive">{claims + ' claims verified'}</Badge>
                    ) : (
                      <Badge tone="warning">Needs review</Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
