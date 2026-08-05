import assert from 'node:assert/strict';
import test from 'node:test';
import { REPORT_PLATFORMS, REPORT_PLATFORM_LABELS } from '@/lib/reports/types';
import { ADAPTER_SUPPORTED_PLATFORMS } from '@/lib/adapters/supported-platforms';
import { NAV_PLATFORMS, NAV_SECTIONS } from './nav';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

test('every supported social platform has a navigation route', () => {
  assert.deepEqual(sorted(NAV_PLATFORMS), sorted(ADAPTER_SUPPORTED_PLATFORMS));

  const social = NAV_SECTIONS.find((section) => section.id === 'social');
  const linkedin = social?.items.find((item) => item.href === '/linkedin');
  assert.equal(linkedin?.label, 'LinkedIn');
  assert.equal(linkedin?.platform, 'linkedin');
});

test('every supported social platform is represented in weekly reports', () => {
  assert.deepEqual(sorted(REPORT_PLATFORMS), sorted(ADAPTER_SUPPORTED_PLATFORMS));
  assert.equal(REPORT_PLATFORM_LABELS.linkedin, 'LinkedIn');
});
