/**
 * Installs the Bright Data spend meter: every delivery the client receives
 * gets written to the vendor_spend ledger the moment it arrives.
 *
 * Import this module for its side effect from any entrypoint that collects
 * (the pooled runner does). Unit tests never import it, so the vendor client
 * stays database-free under test.
 *
 * Two datasets are excluded because their collectors ledger themselves with
 * richer rows (subject and stored counts): recording them here as well would
 * double-count the exact spend this system exists to watch.
 */
import { DATASETS, setSpendRecorder } from './brightdata';
import { estimateBrightDataCents, recordSpend } from './budget';

const SELF_LEDGERED: ReadonlySet<string> = new Set([
  DATASETS.facebookGroupPosts,
  DATASETS.instagramComments,
]);

let installed = false;

export function installSpendMeter(): void {
  if (installed) return;
  installed = true;
  setSpendRecorder((event) => {
    if (SELF_LEDGERED.has(event.datasetId)) return;
    // Fire and forget: metering must never slow or fail a collection. A lost
    // row under-reports by one purchase; a blocked collector loses data.
    void recordSpend({
      vendor: 'brightdata',
      resource: event.datasetId,
      subject: event.platform,
      records: event.records,
      stored: 0,
      snapshotId: event.snapshotId,
      estimatedCents: estimateBrightDataCents(event.records),
    }).catch((error) => {
      console.error('[data-dumpster:meter] failed to record vendor spend', {
        datasetId: event.datasetId,
        records: event.records,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}
