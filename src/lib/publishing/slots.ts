/**
 * Window scheduling: the editor says "sometime this afternoon", the system
 * picks the minute.
 *
 * Pure and deterministic so it can be tested and so the composer can preview
 * exactly the slot the dispatcher will use. Three inputs decide the pick:
 *
 *  1. Posting rules (day-parting). Each target has allowed hours per weekday,
 *     in Boston time, e.g. weekdays 7-10am and 5-11pm, weekends 9am-9pm. A
 *     target with no rules allows any time.
 *  2. Spacing. A minimum gap from anything already queued on the same target,
 *     and a cap on posts per local day.
 *  3. Performance. A weight per local weekday and hour, computed from this
 *     account's own past posts (see performance.ts). With no history every
 *     hour weighs 1 and spacing alone decides.
 */
import { zonedParts, localDayKey } from './zone';

export interface PostingRule {
  /** 0 = Sunday. */
  weekday: number;
  /** Minutes since local midnight, inclusive. */
  startMinute: number;
  /** Minutes since local midnight, exclusive. May be 1440. */
  endMinute: number;
}

export interface SlotPolicy {
  rules: PostingRule[];
  minGapMinutes: number;
  maxPerDay: number | null;
}

/** weights[weekday][hour], 1 = this account's typical hour. */
export type HourWeights = number[][] | null;

export interface SlotRequest {
  windowStart: Date;
  windowEnd: Date;
  now: Date;
  policy: SlotPolicy;
  /** Times already taken on this target (queued or recently sent). */
  taken: Date[];
  weights: HourWeights;
  /** Candidate spacing in minutes. */
  stepMinutes?: number;
  /** Take the first slot that fits instead of the best one (used to catch up after a missed window). */
  earliest?: boolean;
}

export interface SlotPick {
  at: Date;
  /** Plain-English reason shown in the queue. */
  reason: string;
  weight: number;
}

export type SlotResult = { ok: true; pick: SlotPick } | { ok: false; reason: string };

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEAD_MINUTES = 2;

export function allowedAt(rules: PostingRule[], weekday: number, minute: number): boolean {
  if (rules.length === 0) return true;
  return rules.some((r) => r.weekday === weekday && minute >= r.startMinute && minute < r.endMinute);
}

export function clockLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

export function pickSlot(req: SlotRequest): SlotResult {
  const step = (req.stepMinutes ?? 5) * 60000;
  const earliest = Math.max(req.windowStart.getTime(), req.now.getTime() + LEAD_MINUTES * 60000);
  const start = Math.ceil(earliest / step) * step;
  const end = req.windowEnd.getTime();
  if (start > end) return { ok: false, reason: 'The window has already passed.' };

  const gap = req.policy.minGapMinutes * 60000;
  const taken = req.taken.map((d) => d.getTime()).sort((a, b) => a - b);
  const perDay = new Map<string, number>();
  for (const t of taken) {
    const k = localDayKey(new Date(t));
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }

  let best: { t: number; score: number; weight: number; weekday: number; minute: number } | null = null;
  let sawAllowed = false;
  let sawSpaced = false;

  for (let t = start; t <= end; t += step) {
    const p = zonedParts(new Date(t));
    if (!allowedAt(req.policy.rules, p.weekday, p.minute)) continue;
    sawAllowed = true;
    if (req.policy.maxPerDay != null && (perDay.get(localDayKey(new Date(t))) ?? 0) >= req.policy.maxPerDay) continue;
    let nearest = Infinity;
    for (const x of taken) nearest = Math.min(nearest, Math.abs(x - t));
    if (nearest < gap) continue;
    sawSpaced = true;

    const weight = req.weights?.[p.weekday]?.[Math.floor(p.minute / 60)] ?? 1;
    // Prefer room around the post: full credit at twice the minimum gap.
    const spacing = gap === 0 || nearest === Infinity ? 1 : Math.min(1, nearest / (2 * gap));
    const score = weight * (0.75 + 0.25 * spacing);
    if (!best || score > best.score + 1e-9) {
      best = { t, score, weight, weekday: p.weekday, minute: p.minute };
    }
    if (req.earliest) break;
  }

  if (!best) {
    if (!sawAllowed) return { ok: false, reason: 'No allowed posting hours fall inside this window.' };
    if (!sawSpaced) return { ok: false, reason: 'Every allowed slot in this window is too close to another queued post.' };
    return { ok: false, reason: 'This account has hit its daily post limit for every day in the window.' };
  }

  const when = `${DAY[best.weekday]} ${clockLabel(best.minute)}`;
  let reason: string;
  if (req.earliest) {
    reason = `${when}: next open time`;
  } else if (req.weights && Math.abs(best.weight - 1) > 0.05) {
    reason = `${when}: strongest hour in the window for this account (${best.weight.toFixed(1)}x its typical engagement)`;
  } else if (taken.length) {
    reason = `${when}: best spacing from other queued posts`;
  } else {
    reason = `${when}: earliest allowed time`;
  }
  return { ok: true, pick: { at: new Date(best.t), reason, weight: best.weight } };
}
