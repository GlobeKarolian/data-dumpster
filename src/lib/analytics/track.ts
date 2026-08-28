import 'server-only';
import { db } from '@/db';
import { analyticsEvents } from '@/db/schema';

/**
 * First-party product-usage events.
 *
 * No third-party analytics script: the companies a newsroom tracks are
 * themselves competitive, so usage stays in our own tables and is read back in
 * an internal viewer. One row per meaningful action, tagged with a surface and
 * an optional metadata bag.
 *
 * Best-effort by design, same contract as the AI usage ledger: a page view
 * must never fail because its telemetry insert did.
 */

export type AnalyticsSurface =
  | 'ask'
  | 'dashboards'
  | 'reports'
  | 'election'
  | 'content'
  | 'alerts'
  | 'settings'
  | 'briefs';

export type AnalyticsAction =
  | 'view'
  | 'create'
  | 'update'
  | 'delete'
  | 'export'
  | 'run'
  | 'share'
  | 'ask_question';

export interface TrackEvent {
  orgId: string | null;
  userId: string | null;
  surface: AnalyticsSurface;
  action: AnalyticsAction;
  meta?: Record<string, unknown>;
}

export async function track(event: TrackEvent): Promise<void> {
  try {
    await db.insert(analyticsEvents).values({
      orgId: event.orgId,
      userId: event.userId,
      surface: event.surface,
      action: event.action,
      meta: event.meta ?? {},
    });
  } catch (err) {
    console.error('[analytics] failed to record event', {
      surface: event.surface,
      action: event.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
