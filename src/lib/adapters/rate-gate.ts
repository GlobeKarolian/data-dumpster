/** Calls reserved before a channel starts. Reconciled to the measured total afterward. */
export const ESTIMATED_CALLS_PER_RUN = 4;

/** A collection request must spend its time collecting, not sleeping on quota. */
export const MAX_RATE_WAIT_MS = 60_000;

type Clock = () => number;
type Sleeper = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface RateReservation {
  acquired: boolean;
  /** Tokens charged up front. Zero when no reservation was made. */
  reserved: number;
  /** Time already spent waiting before this decision. */
  waitedMs: number;
  /** Current wait estimate when the reservation was deferred. */
  retryAfterMs: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * An in-process token bucket sized from an adapter's declared platform quota.
 *
 * A worker reserves a conservative estimate before it starts. Once the adapter
 * returns, `reconcile` replaces that estimate with the number of network calls
 * measured by `FetchContext.onApiCall`. Keeping the reservation until then
 * prevents concurrent workers from all seeing the same available tokens.
 */
export class RateGate {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private lastRefill: number;
  private readonly now: Clock;
  private readonly sleeper: Sleeper;

  constructor(
    callsPerWindow: number,
    windowSeconds: number,
    testing: { now?: Clock; sleep?: Sleeper } = {},
  ) {
    this.capacity = Math.max(1, callsPerWindow);
    this.tokens = this.capacity;
    this.refillPerMs = this.capacity / Math.max(1, windowSeconds * 1_000);
    this.now = testing.now ?? Date.now;
    this.sleeper = testing.sleep ?? sleep;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const now = this.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + Math.max(0, now - this.lastRefill) * this.refillPerMs,
    );
    this.lastRefill = now;
  }

  private reservationCost(cost: number): number {
    if (!Number.isFinite(cost)) return 0;
    return Math.min(this.capacity, Math.max(0, cost));
  }

  /** Milliseconds until a bounded reservation can be made. */
  waitFor(cost: number): number {
    this.refill();
    const need = this.reservationCost(cost) - this.tokens;
    return need <= 0 ? 0 : Math.ceil(need / this.refillPerMs);
  }

  private take(cost: number): void {
    this.refill();
    // Deliberately allow debt. If a run costs more than its reservation, the
    // next worker waits for those real calls to refill instead of losing them
    // to a zero clamp.
    this.tokens -= Math.max(0, Number.isFinite(cost) ? cost : 0);
  }

  private refund(cost: number): void {
    this.refill();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + Math.max(0, Number.isFinite(cost) ? cost : 0),
    );
  }

  /**
   * Atomically reserve quota, waiting only while the caller's request budget
   * permits. Multiple workers can call this concurrently; each successful call
   * debits synchronously before its promise resolves.
   */
  async acquire(
    cost: number,
    maxWaitMs: number,
    signal?: AbortSignal,
  ): Promise<RateReservation> {
    const reserved = this.reservationCost(cost);
    const startedAt = this.now();
    const safeMaxWait = Math.max(0, maxWaitMs);

    for (;;) {
      const waitedMs = Math.max(0, this.now() - startedAt);
      if (signal?.aborted) {
        return { acquired: false, reserved: 0, waitedMs, retryAfterMs: 0 };
      }

      const retryAfterMs = this.waitFor(reserved);
      if (retryAfterMs === 0) {
        this.take(reserved);
        return { acquired: true, reserved, waitedMs, retryAfterMs: 0 };
      }
      if (retryAfterMs > safeMaxWait - waitedMs) {
        return { acquired: false, reserved: 0, waitedMs, retryAfterMs };
      }
      await this.sleeper(retryAfterMs, signal);
    }
  }

  /** Replace an up-front reservation with the adapter's measured call count. */
  reconcile(reserved: number, actual: number): void {
    const safeReserved = Math.max(0, Number.isFinite(reserved) ? reserved : 0);
    const safeActual = Math.max(0, Number.isFinite(actual) ? actual : 0);
    const difference = safeActual - safeReserved;
    if (difference > 0) this.take(difference);
    else if (difference < 0) this.refund(-difference);
  }
}
