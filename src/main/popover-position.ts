/** Placement of the menu-bar popover. Pure math, no Electron, so it is unit-tested. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Gap between the menu bar and the popover, and minimum distance to the screen edges. */
export const POPOVER_GAP = 4;
export const POPOVER_MARGIN = 8;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Largest height the popover may have in `workArea` (keeps the margins). */
export function maxPopoverHeight(workArea: Rect): number {
  return Math.max(0, workArea.height - 2 * POPOVER_MARGIN);
}

/**
 * Bounds for a popover of `size` anchored at the tray icon: centred under the icon, or above it when the
 * icon sits in the lower half of the display (taskbars on other platforms), always inside `workArea`.
 *
 * `anchor` is the tray icon's bounds (`tray.getBounds()`); some platforms report an empty rect, then pass
 * the cursor position as a 0x0 rect instead.
 */
export function popoverBounds(anchor: Rect, workArea: Rect, size: { width: number; height: number }): Rect {
  const width = Math.min(size.width, Math.max(0, workArea.width - 2 * POPOVER_MARGIN));
  const height = Math.min(size.height, maxPopoverHeight(workArea));

  const centerX = anchor.x + anchor.width / 2;
  const x = clamp(Math.round(centerX - width / 2), workArea.x + POPOVER_MARGIN, workArea.x + workArea.width - width - POPOVER_MARGIN);

  const anchorBelowMiddle = anchor.y + anchor.height / 2 > workArea.y + workArea.height / 2;
  const preferredY = anchorBelowMiddle ? anchor.y - height - POPOVER_GAP : anchor.y + anchor.height + POPOVER_GAP;
  // On macOS the work area starts below the menu bar, so the clamp keeps the popover just under it.
  const y = clamp(Math.round(preferredY), workArea.y + (anchorBelowMiddle ? POPOVER_MARGIN : 0), workArea.y + workArea.height - height - POPOVER_MARGIN);

  return { x, y, width, height };
}

/** True if `rect` has no area (e.g. `tray.getBounds()` on platforms that do not report it). */
export const isEmptyRect = (rect: Rect): boolean => rect.width <= 0 || rect.height <= 0;
