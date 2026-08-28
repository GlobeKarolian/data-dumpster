import 'server-only';
import { db } from '@/db';
import { askInteractions } from '@/db/schema';

/**
 * Server-side Ask interaction log.
 *
 * Every question asked of the Alpha assistant lands here: the question, the
 * answer the model produced, the deterministic verification outcome, and the
 * cost. The point is backend improvement — a "repaired" or "rejected" row is a
 * reproducible failure the verifier caught, tied by fingerprint to the exact
 * fact sheet the model was grounded in, so it can be replayed and the prompt
 * or verifier tightened.
 *
 * Logging must never break the feature. A failed insert is swallowed to
 * console.error, because a user asking a question should not lose their answer
 * to a telemetry hiccup.
 */

export type AskOutcome = 'verified' | 'repaired' | 'rejected' | 'error';

export interface AskLogRecord {
  orgId: string;
  userId: string | null;
  landscapeId: string | null;
  question: string;
  answer: string | null;
  factsFingerprint: string | null;
  model: string | null;
  outcome: AskOutcome;
  verification?: Record<string, number>;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  error?: string | null;
}

export async function logAskInteraction(record: AskLogRecord): Promise<void> {
  try {
    await db.insert(askInteractions).values({
      orgId: record.orgId,
      userId: record.userId,
      landscapeId: record.landscapeId,
      question: record.question,
      answer: record.answer,
      factsFingerprint: record.factsFingerprint,
      model: record.model,
      outcome: record.outcome,
      verification: record.verification ?? {},
      inputTokens: record.inputTokens ?? 0,
      outputTokens: record.outputTokens ?? 0,
      costUsd: record.costUsd ?? 0,
      latencyMs: record.latencyMs ?? null,
      error: record.error ?? null,
    });
  } catch (err) {
    console.error('[ask] failed to log interaction', {
      outcome: record.outcome,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
