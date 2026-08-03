/**
 * POST /api/ai/ask -- natural-language questions over one landscape and window.
 *
 * The model is handed a fact sheet our own SQL computed and nothing else: no
 * database access, no tools, no browsing. Everything it is allowed to say is
 * already on the screen next to the answer, which is the entire reason an
 * editor can forward one of these without checking it first.
 *
 * On the response shape. lib/ai/client.ts exposes complete(), which resolves
 * with a finished CompletionResult -- there is no token-level stream to relay,
 * because retries, metering and cost accounting all need a completed call. So
 * this endpoint awaits the completion and then writes it to the response body
 * as a single chunk over a streaming response. That is deliberately not a fake
 * token stream: chopping finished text into timed fragments would imply the
 * model was still thinking and would make a slow endpoint look fast.
 *
 * Awaiting before the body opens also keeps failures honest. Once a 200 has
 * been sent, a provider error can only be delivered as prose inside the answer,
 * where it is indistinguishable from something the model said. Completing first
 * means a refused key is a 502 with a message, and components/ask/ask-chat.tsx
 * renders it in the error banner instead of the transcript.
 *
 * The grounding metadata that would otherwise be a "meta" event rides in
 * response headers, because the client accumulates the raw body straight into
 * markdown -- any envelope written into the body would render as literal text
 * in the answer.
 */
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { apiHandler, assertLandscapeInOrg, requireOrg, HttpError } from '@/lib/session';
import { checkRateLimit, LIMITS } from '../../_lib/rate-limit';
import { getFactSheet } from '@/lib/metrics/queries';
import { complete } from '@/lib/ai/client';
import { askDataPrompt } from '@/lib/ai/prompts';
import { ModelError, type ModelMessage } from '@/lib/ai/types';
import { parseRangeParams } from '@/lib/dates';
import { readJson, RANGE_PRESETS } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One completion over a large prompt, with retries. */
export const maxDuration = 120;

/**
 * History is capped rather than trusted. It arrives from the browser, it is
 * prepended verbatim to a prompt the org pays for by the token, and a long
 * transcript crowds out the fact sheet the answer has to be grounded in.
 */
const MAX_HISTORY_TURNS = 10;

const askSchema = z.object({
  landscapeId: z.uuid('landscapeId must be a landscape UUID.'),
  question: z.string().trim().min(1, 'Ask a question.').max(2000),
  start: z.iso.date().optional(),
  end: z.iso.date().optional(),
  range: z.enum(RANGE_PRESETS).optional(),
  connectionId: z.uuid().optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(8000),
  })).max(50).optional(),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireOrg();
  // Available to a viewer, and every call bills the org's own model.
  const gate = checkRateLimit(orgId, LIMITS.ai);
  if (!gate.ok) throw new HttpError(429, gate.message, 'rate_limited');
  const body = await readJson(req, askSchema);

  // The landscape id is a claim until this line; after it, it is a fact.
  const landscape = await assertLandscapeInOrg(body.landscapeId, orgId);

  const sp = new URLSearchParams();
  if (body.start) sp.set('start', body.start);
  if (body.end) sp.set('end', body.end);
  if (body.range) sp.set('range', body.range);
  const range = parseRangeParams(sp);

  const facts = await getFactSheet({
    orgId,
    landscapeId: landscape.id,
    start: range.start,
    end: range.end,
    compare: true,
  });

  const request = askDataPrompt(body.question, facts);

  /**
   * The prompt is [system, user]; earlier turns belong between them so the
   * hard rules stay first and the fact sheet stays last, closest to the
   * question it has to answer.
   */
  const history: ModelMessage[] = (body.history ?? [])
    .slice(-MAX_HISTORY_TURNS)
    .filter((turn) => turn.content.trim().length > 0)
    .map((turn) => ({ role: turn.role, content: turn.content }));
  const messages = history.length > 0
    ? [request.messages[0], ...history, ...request.messages.slice(1)]
    : request.messages;

  let answer: string;
  let model: string;
  try {
    const result = await complete(orgId, { ...request, messages }, {
      connectionId: body.connectionId,
      feature: 'ask',
    });
    answer = result.text.trim();
    model = result.model;
  } catch (err) {
    // Provider messages are already written for a human and carry no secrets.
    if (err instanceof ModelError) throw new HttpError(502, err.message, 'model_error');
    throw err;
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(answer));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'private, no-store',
      // Proxies that buffer would defeat the point of a streaming body.
      'x-accel-buffering': 'no',
      // The grounding the answer is pinned to, for anyone debugging an answer.
      'x-pressbox-model': model,
      'x-pressbox-range': facts.range.start + '/' + facts.range.end,
      'x-pressbox-companies': String(facts.companies.length),
      'x-pressbox-caveats': String(facts.caveats.length),
    },
  });
});
