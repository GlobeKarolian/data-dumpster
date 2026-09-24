/**
 * POST /api/leakage/runs/:id/analysis
 *
 * Reads a saved run with the org's AI model: account types, which leaked
 * copies were paywall workarounds, the stance of the most-seen posts, and
 * plain-English findings. Saved on the run, so it runs once; ?force=1 redoes
 * it. Metered as feature "article-leakage".
 */
import type { NextRequest } from 'next/server';
import { apiHandler, HttpError } from '@/lib/session';
import { complete } from '@/lib/ai/client';
import { ModelError } from '@/lib/ai/types';
import { requireLeakageUser } from '@/lib/leakage/guard';
import { getRun, saveAnalysis } from '@/lib/leakage/store';
import { buildAnalysisPrompt, validateAnalysis, type AnalysisAccount, type LeakageAnalysis } from '@/lib/leakage/analysis';
import { AUTOMATED_ACCOUNTS, type SharePost, type ShareSummary } from '@/lib/leakage/story-shares';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
}

export const POST = apiHandler(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const session = await requireLeakageUser();
  const { id } = await context.params;
  if (!UUID.test(id)) throw new HttpError(404, 'Not found.', 'not_found');
  const run = await getRun(session.orgId, id);
  if (!run) throw new HttpError(404, 'Not found.', 'not_found');
  if (run.analysis && req.nextUrl.searchParams.get('force') !== '1') {
    return Response.json({ analysis: run.analysis }, { headers: { 'cache-control': 'no-store' } });
  }

  const isPerson = (name: string) => !AUTOMATED_ACCOUNTS.has(name.toLowerCase());
  const posts = (run.posts as SharePost[]).filter((p) => isPerson(p.author));
  const accounts = (run.accounts as Array<AnalysisAccount & { automated?: boolean }>).filter((a) => !a.automated && isPerson(a.username));
  if (posts.length === 0) throw new HttpError(422, 'This run has no posts to read.', 'empty_run');

  const s = run.summary as ShareSummary;
  const summaryLine = [
    s.people + ' people, ' + s.posts + ' posts, ' + s.views + ' views, ' + s.reposts + ' reposts',
    'linked the story: ' + s.linked.posts + ' posts, ' + s.linked.views + ' views',
    'no link: ' + s.unlinked.posts + ' posts, ' + s.unlinked.views + ' views',
    'leaked copies: ' + s.leaked.posts + ' posts from ' + s.leaked.accounts + ' accounts, ' + s.leaked.views + ' views, '
      + s.leaked.asReplies + ' of them replies, median leaker followers ' + s.leaked.medianFollowers
      + ' versus ' + s.linked.medianFollowers + ' for people linking the story',
  ].join('; ');

  const { request, postIds } = buildAnalysisPrompt({
    headline: run.story_meta?.headline ?? null,
    storyKey: run.story_key,
    summaryLine,
    accounts,
    posts,
  });
  let completion;
  try {
    completion = await complete(session.orgId, request, { feature: 'article-leakage' });
  } catch (error) {
    // Say what actually happened; a bare 500 hid an empty AI account.
    if (error instanceof ModelError) {
      const status = error.opts.status;
      const message = status === 402
        ? 'The AI account (' + error.opts.provider + ') is out of credits, so the posts could not be read. Add credits and try again; the numbers above are unaffected.'
        : status === 401 || status === 403
          ? 'The AI connection was refused (' + error.opts.provider + ' ' + status + '). Check Settings > Model Connections.'
          : 'The AI model did not answer (' + error.opts.provider + (status ? ' ' + status : '') + '). Try again in a minute.';
      throw new HttpError(status === 402 ? 402 : 502, message, 'model_error');
    }
    throw error;
  }
  const leakedUrls = new Set(posts.filter((p) => p.link === 'bypass').map((p) => p.url));
  const validated = validateAnalysis(completion.json ?? safeParse(completion.text), accounts, postIds, leakedUrls);
  const analysis: LeakageAnalysis = {
    ...validated,
    model: completion.model ?? null,
    costUsd: completion.costUsd,
    analyzedAt: new Date().toISOString(),
  };
  await saveAnalysis(session.orgId, id, analysis);
  return Response.json({ analysis }, { headers: { 'cache-control': 'no-store' } });
});
