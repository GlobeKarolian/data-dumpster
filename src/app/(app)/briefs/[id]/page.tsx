import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Cpu } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatFullDate, formatDateTime } from '@/components/ui/format';
import { Markdown } from '@/components/briefs/markdown';
import { VerificationPanel } from '@/components/briefs/verification-panel';
import { parseVerification } from '@/components/briefs/verification';
import { query } from '../../_lib/data';

export const metadata: Metadata = { title: 'Brief' };

type BriefRow = {
  id: string;
  title: string;
  body: string;
  facts: Record<string, unknown>;
  model_used: string | null;
  period_start: string;
  period_end: string;
  created_at: string;
  landscape_name: string;
};

export default async function BriefDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { requireOrg } = await import('@/lib/session');
  const { orgId } = await requireOrg();

  const result = await query<BriefRow>(({ sql }) => sql`
    SELECT b.id, b.title, b.body, b.facts, b.model_used,
           b.period_start, b.period_end, b.created_at,
           l.name AS landscape_name
      FROM briefs b
      JOIN landscapes l ON l.id = b.landscape_id
     WHERE b.id = ${id}::uuid
       AND b.org_id = ${orgId}::uuid
     LIMIT 1
  `);

  const brief = result.data[0];
  if (!brief) notFound();

  const verification = parseVerification(brief.facts);
  const caveats = Array.isArray((brief.facts as { caveats?: unknown }).caveats)
    ? ((brief.facts as { caveats: unknown[] }).caveats.filter((c): c is string => typeof c === 'string'))
    : [];

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/briefs"
        className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowRight className="h-3 w-3 rotate-180" aria-hidden />
        All briefs
      </Link>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="items-start">
              <div className="min-w-0">
                <CardTitle className="text-base">{brief.title}</CardTitle>
                <p className="pb-num mt-1 text-[11px] text-zinc-500">
                  {brief.landscape_name +
                    ' · ' +
                    formatFullDate(brief.period_start) +
                    ' – ' +
                    formatFullDate(brief.period_end) +
                    ' · written ' +
                    formatDateTime(brief.created_at)}
                </p>
              </div>
              {brief.model_used ? (
                <Badge tone="neutral">
                  <Cpu className="h-2.5 w-2.5" aria-hidden />
                  {brief.model_used}
                </Badge>
              ) : null}
            </CardHeader>
            {verification && !verification.ok ? (
              /*
               * Attached to the prose, not filed beside it.
               *
               * The verification panel already existed in the sidebar, which is
               * a summary for someone who goes looking. A brief with a claim
               * that could not be traced to the fact sheet has to say so where
               * the claim is read, and has to survive being copied into an
               * email, because the sidebar does not.
               */
              <div
                role="alert"
                className="mx-5 mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/40"
              >
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                  {verification.unverified.length === 1
                    ? 'One figure below could not be traced to the data.'
                    : verification.unverified.length + ' figures below could not be traced '
                      + 'to the data.'}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {verification.unverified.slice(0, 5).map((u, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                      {'— ' + u}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                  Everything else was checked against the fact sheet. Treat the figures above as
                  unconfirmed and do not forward them without checking.
                </p>
              </div>
            ) : null}
            <CardBody className="px-5 py-4">
              <Markdown source={brief.body} />
            </CardBody>
          </Card>

          {caveats.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Caveats carried from the data</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-2">
                  {caveats.map((c, i) => (
                    <li key={i} className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {'— ' + c}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="lg:sticky lg:top-20">
            <VerificationPanel verification={verification} />
          </div>
        </div>
      </div>
    </div>
  );
}
