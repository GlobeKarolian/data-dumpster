export const DESTINATION_STATUSES = [
  'not_requested',
  'pending',
  'sending',
  'succeeded',
  'failed',
  'unknown',
] as const;

export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

export type DestinationAction = 'send' | 'done' | 'blocked';

/**
 * Only an unsent destination or one that returned an explicit rejection may
 * be attempted. A sending/unknown state may already have reached the provider,
 * so retrying it would risk a duplicate.
 */
export function destinationAction(status: DestinationStatus): DestinationAction {
  if (status === 'pending' || status === 'failed') return 'send';
  if (status === 'sending' || status === 'unknown') return 'blocked';
  return 'done';
}

/** A crashed process may have sent after persisting `sending`. Fail closed. */
export function recoverDestinationStatus(status: DestinationStatus): DestinationStatus {
  return status === 'sending' ? 'unknown' : status;
}

export function deliverySucceeded(
  email: DestinationStatus,
  slack: DestinationStatus,
): boolean {
  const complete = (status: DestinationStatus) => (
    status === 'not_requested' || status === 'succeeded'
  );
  return complete(email) && complete(slack);
}

/**
 * A manual-run retry key is safe to release only after this request completed
 * successfully, or when the server proves a skipped request points at the same
 * delivery claim and that claim had already succeeded.
 */
export function canReleaseManualRunKey(outcome: {
  status?: string;
  alreadySucceeded?: boolean;
}): boolean {
  return outcome.status === 'succeeded'
    || (outcome.status === 'skipped' && outcome.alreadySucceeded === true);
}

export function reportSlackBindingError(input: {
  orgId: string;
  webhook: string | undefined;
  boundOrgId: string | undefined;
}): string | null {
  if (!input.webhook?.trim() || !input.boundOrgId?.trim()) {
    return 'Slack report delivery is disabled until SLACK_WEBHOOK_URL and '
      + 'REPORT_SLACK_ORG_ID are both configured.';
  }
  if (input.boundOrgId.trim() !== input.orgId) {
    return 'Slack report delivery refused because REPORT_SLACK_ORG_ID does not match '
      + 'the schedule organization.';
  }
  return null;
}
