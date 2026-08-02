import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReleaseManualRunKey,
  deliverySucceeded,
  destinationAction,
  recoverDestinationStatus,
  reportSlackBindingError,
} from './delivery-state';

test('only pending and explicitly failed destinations are safe to send', () => {
  assert.equal(destinationAction('pending'), 'send');
  assert.equal(destinationAction('failed'), 'send');
  assert.equal(destinationAction('succeeded'), 'done');
  assert.equal(destinationAction('not_requested'), 'done');
});

test('ambiguous destination outcomes are never blindly retried', () => {
  assert.equal(destinationAction('sending'), 'blocked');
  assert.equal(destinationAction('unknown'), 'blocked');
  assert.equal(recoverDestinationStatus('sending'), 'unknown');
  assert.equal(recoverDestinationStatus('succeeded'), 'succeeded');
});

test('a delivery succeeds only when every requested destination succeeded', () => {
  assert.equal(deliverySucceeded('succeeded', 'not_requested'), true);
  assert.equal(deliverySucceeded('not_requested', 'succeeded'), true);
  assert.equal(deliverySucceeded('succeeded', 'succeeded'), true);
  assert.equal(deliverySucceeded('failed', 'succeeded'), false);
  assert.equal(deliverySucceeded('succeeded', 'unknown'), false);
});

test('manual retry keys survive fresh-running and ambiguous skipped outcomes', () => {
  assert.equal(canReleaseManualRunKey({ status: 'succeeded' }), true);
  assert.equal(canReleaseManualRunKey({
    status: 'skipped',
    alreadySucceeded: true,
  }), true);
  assert.equal(canReleaseManualRunKey({
    status: 'skipped',
    alreadySucceeded: false,
  }), false);
  assert.equal(canReleaseManualRunKey({ status: 'skipped' }), false);
  assert.equal(canReleaseManualRunKey({ status: 'failed' }), false);
});

test('a global Slack webhook fails closed unless it is bound to the schedule org', () => {
  assert.match(
    reportSlackBindingError({
      orgId: 'org-a',
      webhook: 'https://hooks.slack.test/a',
      boundOrgId: undefined,
    }) ?? '',
    /REPORT_SLACK_ORG_ID/,
  );
  assert.match(
    reportSlackBindingError({
      orgId: 'org-a',
      webhook: 'https://hooks.slack.test/a',
      boundOrgId: 'org-b',
    }) ?? '',
    /does not match/,
  );
  assert.equal(
    reportSlackBindingError({
      orgId: 'org-a',
      webhook: 'https://hooks.slack.test/a',
      boundOrgId: 'org-a',
    }),
    null,
  );
});
