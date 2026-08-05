import type { Metadata } from 'next';
import { toDayString } from '@/lib/dates';
import { NoLandscape } from '@/components/common/no-landscape';
import { AskChat } from '@/components/ask/ask-chat';
import {
  factSheetFingerprint,
  factSheetScopeFromQuery,
} from '@/lib/metrics/fact-sheet-request';
import { analyticsQuery, resolveContext } from '../_lib/context';
import { loadFactSheet, type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Ask' };

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const query = analyticsQuery(ctx);
  const facts = await loadFactSheet(query);
  const fingerprint = facts.data ? factSheetFingerprint(facts.data) : null;

  return (
    <div className="mx-auto max-w-6xl">
      {facts.error ? (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {'The fact sheet could not be computed, so answers cannot be grounded: ' + facts.error}
        </p>
      ) : null}
      <AskChat
        key={fingerprint ?? 'unavailable'}
        landscapeId={ctx.landscape.id}
        landscapeName={ctx.landscape.name}
        start={toDayString(ctx.range.start)}
        end={toDayString(ctx.range.end)}
        facts={facts.data}
        factsFingerprint={fingerprint}
        scope={factSheetScopeFromQuery(query)}
      />
    </div>
  );
}
