/**
 * Cooperative lease renewal for a batch of independently fenced queue rows.
 *
 * The database remains the authority: `renew` must return only channel ids
 * whose row still has the expected lease token and an unexpired lease. Missing
 * ids are treated as ownership loss and their work receives an abort signal.
 */

export class LeaseOwnershipLostError extends Error {
  constructor(
    readonly channelId: string,
    message = 'Collection lease ownership was lost.',
  ) {
    super(message);
    this.name = 'LeaseOwnershipLostError';
  }
}

export interface LeaseHeartbeatScheduler {
  schedule(callback: () => Promise<void>, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const systemScheduler: LeaseHeartbeatScheduler = {
  schedule(callback, delayMs) {
    return setTimeout(() => {
      // The heartbeat converts renewal failures into ownership loss. Keep this
      // final rejection handler so an unexpected programming error can never
      // become an unhandled timer promise.
      void callback().catch(() => undefined);
    }, delayMs);
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function leaseHeartbeatIntervalMs(leaseMs: number): number {
  if (!Number.isFinite(leaseMs) || leaseMs < 3) {
    throw new RangeError('Lease duration must be at least three milliseconds.');
  }
  return Math.floor(leaseMs / 3);
}

type LeaseStatus = 'active' | 'finishing' | 'lost';

interface LeaseState {
  status: LeaseStatus;
  controller: AbortController;
}

interface InFlightRenewal {
  ids: ReadonlySet<string>;
  promise: Promise<void>;
}

export class TokenFencedLeaseHeartbeat {
  private readonly states = new Map<string, LeaseState>();
  private readonly renew: (channelIds: readonly string[]) => Promise<readonly string[]>;
  private readonly scheduler: LeaseHeartbeatScheduler;
  private readonly intervalMs: number;
  private timer: unknown | null = null;
  private inFlight: InFlightRenewal | null = null;
  private started = false;
  private stopped = false;

  constructor(input: {
    channelIds: readonly string[];
    leaseMs: number;
    intervalMs?: number;
    renew: (channelIds: readonly string[]) => Promise<readonly string[]>;
    scheduler?: LeaseHeartbeatScheduler;
  }) {
    const intervalMs = input.intervalMs ?? leaseHeartbeatIntervalMs(input.leaseMs);
    if (
      !Number.isFinite(intervalMs)
      || intervalMs <= 0
      || intervalMs >= input.leaseMs / 2
    ) {
      throw new RangeError('Lease heartbeat interval must be positive and less than half the lease.');
    }

    for (const channelId of new Set(input.channelIds)) {
      this.states.set(channelId, {
        status: 'active',
        controller: new AbortController(),
      });
    }
    this.intervalMs = intervalMs;
    this.renew = input.renew;
    this.scheduler = input.scheduler ?? systemScheduler;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.scheduleNext();
  }

  signalFor(channelId: string): AbortSignal {
    const state = this.states.get(channelId);
    if (!state) throw new Error('No heartbeat state for channel ' + channelId + '.');
    return state.controller.signal;
  }

  owns(channelId: string): boolean {
    const status = this.states.get(channelId)?.status;
    return status === 'active' || status === 'finishing';
  }

  /**
   * Stop renewing one row and wait for any renewal already containing it.
   * Callers must still use a token-and-expiry-fenced database update to finish;
   * this method only makes that final update race-free with the heartbeat.
   */
  async releaseForFinish(channelId: string): Promise<boolean> {
    const initial = this.states.get(channelId);
    if (!initial) return false;
    if (initial.status === 'lost') {
      this.states.delete(channelId);
      return false;
    }

    initial.status = 'finishing';
    this.cancelTimerWhenIdle();
    const renewal = this.inFlight;
    if (renewal?.ids.has(channelId)) await renewal.promise;

    const current = this.states.get(channelId);
    const owned = current?.status === 'finishing';
    this.states.delete(channelId);
    this.scheduleNext();
    return owned;
  }

  /** Clear every timer and await the last database renewal before returning. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) {
      this.scheduler.cancel(this.timer);
      this.timer = null;
    }
    if (this.inFlight) await this.inFlight.promise;

    for (const [channelId, state] of this.states) {
      if (state.status !== 'lost') {
        this.markLost(
          channelId,
          'Collection lease heartbeat stopped before the channel finished.',
        );
      }
    }
    this.states.clear();
  }

  private activeChannelIds(): string[] {
    return [...this.states]
      .filter(([, state]) => state.status === 'active')
      .map(([channelId]) => channelId);
  }

  private scheduleNext(): void {
    if (
      !this.started
      || this.stopped
      || this.timer !== null
      || this.inFlight !== null
      || this.activeChannelIds().length === 0
    ) return;

    this.timer = this.scheduler.schedule(async () => {
      this.timer = null;
      await this.pulse();
    }, this.intervalMs);
  }

  private cancelTimerWhenIdle(): void {
    if (this.activeChannelIds().length > 0 || this.timer === null) return;
    this.scheduler.cancel(this.timer);
    this.timer = null;
  }

  private async pulse(): Promise<void> {
    if (this.stopped) return;
    const channelIds = this.activeChannelIds();
    if (channelIds.length === 0) return;

    const ids = new Set(channelIds);
    const promise = this.renewAndFence(channelIds);
    const renewal = { ids, promise };
    this.inFlight = renewal;
    await promise;
    if (this.inFlight === renewal) this.inFlight = null;
    this.scheduleNext();
  }

  private async renewAndFence(channelIds: readonly string[]): Promise<void> {
    let renewed: readonly string[];
    try {
      renewed = await this.renew(channelIds);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown database error.';
      for (const channelId of channelIds) {
        this.markLost(
          channelId,
          'Collection lease renewal failed; ownership can no longer be proven: ' + detail,
        );
      }
      return;
    }

    const owned = new Set(renewed);
    for (const channelId of channelIds) {
      if (!owned.has(channelId)) {
        this.markLost(
          channelId,
          'Collection lease ownership was lost before the work finished.',
        );
      }
    }
  }

  private markLost(channelId: string, message: string): void {
    const state = this.states.get(channelId);
    if (!state || state.status === 'lost') return;
    state.status = 'lost';
    state.controller.abort(new LeaseOwnershipLostError(channelId, message));
  }
}
