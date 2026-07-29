import type { Metadata } from 'next';
import { PageSection } from '@/components/shell/page-section';
import { Panel } from '@/components/common/panel';
import { NoLandscape } from '@/components/common/no-landscape';
import { GlanceRow } from '@/components/content/glance-row';
import { DimensionTable } from '@/components/content/dimension-table';
import { TimesChart } from '@/components/content/times-chart';
import {
  topicsInsight, hashtagsInsight, typesInsight, channelsInsight, timesInsight,
} from '@/components/content/insight';
import { resolveContext } from '../_lib/context';
import { tryQuery, type SearchParamsInput } from '../_lib/data';
import type { ContentAnalysis } from '@/lib/metrics/content-analysis';

export const metadata: Metadata = { title: 'Content Analysis' };

/**
 * Content analysis.
 *
 * Answers "what should we publish" rather than "how did we do", which is the
 * question that changes behaviour. Every card follows the same rule: show the
 * focus company, show the market, and put one sentence of interpretation on
 * top so nobody has to read a table to get the point.
 */
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const result = await tryQuery<ContentAnalysis | null>(async () => {
    const { getContentAnalysis } = await import('@/lib/metrics/content-analysis');
    return getContentAnalysis({
      landscapeId: ctx.landscape!.id,
      orgId: ctx.orgId,
      start: ctx.range.start,
      end: ctx.range.end,
      platforms: ctx.platforms,
    });
  }, null);

  const a = result.data;
  if (!a) {
    return (
      <PageSection title="Content analysis">
        <Panel title="Could not load" error={result.error}><span /></Panel>
      </PageSection>
    );
  }
  const focus = a.focusCompanyName;

  if (a.totalPosts === 0) {
    return (
      <PageSection title="Content analysis">
        <Panel
          title="Nothing published in this window"
          description="Widen the date range, or connect channels on the Sources screen."
        >
          <span />
        </Panel>
      </PageSection>
    );
  }

  return (
    <PageSection
      title="Content analysis"
      description={
        'What ' + (focus ?? 'the focus company') + ' publishes, against what the market publishes, '
        + 'and which of those choices actually earn engagement. '
        + a.totalPosts.toLocaleString('en-US') + ' posts in this window.'
      }
    >
      <div className="space-y-3">
        <Panel title={(focus ?? 'Focus company') + ' at a glance'}>
          <GlanceRow glance={a.glance} focusName={focus} />
        </Panel>

        <div className="grid gap-3 xl:grid-cols-2">
          <Panel title="Popular topics" description={topicsInsight(a)}>
            <DimensionTable rows={a.topics} keyLabel="Topic" focusName={focus} />
          </Panel>

          <Panel title="Hashtags" description={hashtagsInsight(a)}>
            <DimensionTable rows={a.hashtags} keyLabel="Hashtag" focusName={focus} />
          </Panel>

          <Panel title="Post types" description={typesInsight(a)}>
            <DimensionTable rows={a.postTypes} keyLabel="Format" focusName={focus} />
          </Panel>

          <Panel title="Post channels" description={channelsInsight(a)}>
            <DimensionTable rows={a.channels} keyLabel="Channel" focusName={focus} />
          </Panel>
        </div>

        <Panel
          title="Post times"
          description={timesInsight(a.byHour, a.glance.topHour)}
        >
          <div className="space-y-6">
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">
                By hour. Bars are your volume, red is your engagement rate, dashed is the market.
              </p>
              <TimesChart data={a.byHour} kind="hour" />
            </div>
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">By weekday</p>
              <TimesChart data={a.byWeekday} kind="weekday" />
            </div>
          </div>
        </Panel>
      </div>
    </PageSection>
  );
}
