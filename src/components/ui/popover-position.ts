export interface PopoverRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface PopoverPosition {
  top: number;
  left: number;
}

const VIEWPORT_GUTTER = 8;
const PANEL_GAP = 6;

/**
 * Place a portaled popover beside its trigger without letting it escape the
 * viewport. Prefer opening below; flip above only when the full panel fits.
 */
export function calculatePopoverPosition({
  trigger,
  panel,
  viewportWidth,
  viewportHeight,
  align,
}: {
  trigger: PopoverRect;
  panel: PopoverRect;
  viewportWidth: number;
  viewportHeight: number;
  align: 'start' | 'end';
}): PopoverPosition {
  const preferredLeft = align === 'end' ? trigger.right - panel.width : trigger.left;
  const maxLeft = Math.max(VIEWPORT_GUTTER, viewportWidth - VIEWPORT_GUTTER - panel.width);
  const left = Math.min(Math.max(preferredLeft, VIEWPORT_GUTTER), maxLeft);

  const below = trigger.bottom + PANEL_GAP;
  const above = trigger.top - PANEL_GAP - panel.height;
  const maxTop = Math.max(VIEWPORT_GUTTER, viewportHeight - VIEWPORT_GUTTER - panel.height);
  const top = below + panel.height <= viewportHeight - VIEWPORT_GUTTER
    ? below
    : above >= VIEWPORT_GUTTER
      ? above
      : Math.min(Math.max(below, VIEWPORT_GUTTER), maxTop);

  return { top, left };
}
