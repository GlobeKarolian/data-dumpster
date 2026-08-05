import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePopoverPosition, type PopoverRect } from './popover-position';

function rect(values: Partial<PopoverRect>): PopoverRect {
  return {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
    ...values,
  };
}

test('aligns an end-anchored panel below its trigger', () => {
  assert.deepEqual(calculatePopoverPosition({
    trigger: rect({ top: 40, right: 1000, bottom: 76, left: 800, width: 200, height: 36 }),
    panel: rect({ width: 288, height: 300 }),
    viewportWidth: 1200,
    viewportHeight: 800,
    align: 'end',
  }), { top: 82, left: 712 });
});

test('keeps a panel inside the horizontal viewport', () => {
  assert.deepEqual(calculatePopoverPosition({
    trigger: rect({ top: 40, right: 96, bottom: 76, left: 8, width: 88, height: 36 }),
    panel: rect({ width: 288, height: 300 }),
    viewportWidth: 320,
    viewportHeight: 800,
    align: 'end',
  }), { top: 82, left: 8 });
});

test('flips above when there is not enough room below', () => {
  assert.deepEqual(calculatePopoverPosition({
    trigger: rect({ top: 600, right: 1000, bottom: 636, left: 800, width: 200, height: 36 }),
    panel: rect({ width: 288, height: 300 }),
    viewportWidth: 1200,
    viewportHeight: 800,
    align: 'end',
  }), { top: 294, left: 712 });
});
