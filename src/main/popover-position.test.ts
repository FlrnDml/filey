import { describe, expect, it } from 'vitest';
import { isEmptyRect, maxPopoverHeight, POPOVER_GAP, POPOVER_MARGIN, popoverBounds, type Rect } from './popover-position';

// A 1440x900 display with the macOS menu bar (24px) above the work area.
const workArea: Rect = { x: 0, y: 24, width: 1440, height: 876 };
const size = { width: 360, height: 480 };

describe('popoverBounds', () => {
  it('centres the popover under the tray icon, just below the menu bar', () => {
    const tray: Rect = { x: 1000, y: 0, width: 28, height: 24 };
    expect(popoverBounds(tray, workArea, size)).toEqual({ x: 1014 - 180, y: 24 + POPOVER_GAP, width: 360, height: 480 });
  });

  it('keeps the popover inside the right and left edges', () => {
    expect(popoverBounds({ x: 1420, y: 0, width: 20, height: 24 }, workArea, size).x).toBe(1440 - 360 - POPOVER_MARGIN);
    expect(popoverBounds({ x: 0, y: 0, width: 20, height: 24 }, workArea, size).x).toBe(POPOVER_MARGIN);
  });

  it('works on a secondary display with negative coordinates', () => {
    const left: Rect = { x: -1920, y: 24, width: 1920, height: 1056 };
    const bounds = popoverBounds({ x: -100, y: 0, width: 28, height: 24 }, left, size);
    expect(bounds.x).toBe(-1920 + 1920 - 360 - POPOVER_MARGIN);
    expect(bounds.y).toBe(28);
  });

  it('opens above an icon in a bottom taskbar', () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1040 };
    const bounds = popoverBounds({ x: 1700, y: 1044, width: 24, height: 32 }, area, size);
    expect(bounds.y).toBe(1040 - 480 - POPOVER_MARGIN);
  });

  it('shrinks to the work area on small screens', () => {
    const small: Rect = { x: 0, y: 24, width: 800, height: 400 };
    const bounds = popoverBounds({ x: 700, y: 0, width: 28, height: 24 }, small, { width: 360, height: 560 });
    expect(bounds.height).toBe(maxPopoverHeight(small));
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(small.y + small.height - POPOVER_MARGIN);
  });

  it('accepts a cursor point as a 0x0 anchor', () => {
    expect(popoverBounds({ x: 500, y: 10, width: 0, height: 0 }, workArea, size)).toMatchObject({ x: 320, y: 24 });
  });
});

describe('isEmptyRect', () => {
  it('detects empty tray bounds', () => {
    expect(isEmptyRect({ x: 0, y: 0, width: 0, height: 0 })).toBe(true);
    expect(isEmptyRect({ x: 0, y: 0, width: 22, height: 24 })).toBe(false);
  });
});
