/**
 * Run refresh waves back to back inside one function invocation.
 *
 * A refresh processes ten channels per wave, and each wave used to wake the
 * next one with a fresh request to /api/ingest/worker. A 144-profile refresh
 * therefore needed a chain of fifteen self-invocations, and Vercel's
 * recursion protection cut the chain with HTTP 508 (Loop Detected) after a
 * few hops, so refreshes stalled on "Preparing the next worker wave" until
 * the ten-minute recovery cron picked the work up (23 Sep 2026).
 *
 * Looping here while time remains means each hop carries several waves, so
 * the chain is several times shorter. The budget stops starting new waves
 * early enough that the last one can finish inside the 300-second limit; a
 * slow Facebook wave takes about two minutes.
 */
export const REFRESH_WAVE_TIME_BUDGET_MS = 120_000;
const MAX_WAVES_PER_INVOCATION = 50;

export interface WaveOutcome {
  dispatchNext: boolean;
}

export async function runWavesWithinBudget(
  runWave: () => Promise<WaveOutcome>,
  options: { budgetMs?: number; now?: () => number; maxWaves?: number } = {},
): Promise<{ waves: number; dispatchNext: boolean }> {
  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? REFRESH_WAVE_TIME_BUDGET_MS;
  const maxWaves = options.maxWaves ?? MAX_WAVES_PER_INVOCATION;
  const startedAt = now();
  let waves = 0;
  let outcome: WaveOutcome;
  do {
    outcome = await runWave();
    waves += 1;
  } while (outcome.dispatchNext && waves < maxWaves && now() - startedAt < budgetMs);
  return { waves, dispatchNext: outcome.dispatchNext };
}
