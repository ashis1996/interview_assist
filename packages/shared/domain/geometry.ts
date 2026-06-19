// Pure geometry and opacity helpers for the Overlay_UI Window Manager.
// Relocated verbatim from v1 src/main/domain. Side-effect free; never mutates.

/** A width/height pair, e.g. a display's pixel dimensions. */
export interface Size {
  width: number
  height: number
}

/** A positioned rectangle: top-left corner (x, y) plus dimensions. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Minimum overlay width in pixels (Req 6.1). */
export const MIN_OVERLAY_WIDTH = 200
/** Minimum overlay height in pixels (Req 6.1). */
export const MIN_OVERLAY_HEIGHT = 150
/** Minimum opacity percentage. */
export const MIN_OPACITY_PERCENT = 0
/** Maximum opacity percentage. */
export const MAX_OPACITY_PERCENT = 100

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

/**
 * Reposition a rectangle so it lies fully within the display bounds on both
 * axes, preserving its width and height. Pure; returns a new Rect.
 */
export function constrainPosition(rect: Rect, display: Size): Rect {
  const maxX = Math.max(0, display.width - rect.width)
  const maxY = Math.max(0, display.height - rect.height)
  return {
    x: clamp(rect.x, 0, maxX),
    y: clamp(rect.y, 0, maxY),
    width: rect.width,
    height: rect.height
  }
}

/**
 * Clamp an overlay size to its allowed bounds: width [200, displayWidth],
 * height [150, displayHeight]. Pure; returns a new Size.
 */
export function constrainSize(size: Size, display: Size): Size {
  return {
    width: clamp(size.width, MIN_OVERLAY_WIDTH, display.width),
    height: clamp(size.height, MIN_OVERLAY_HEIGHT, display.height)
  }
}

/** Clamp an opacity percentage into the inclusive range [0, 100]. Pure. */
export function clampOpacityPercent(value: number): number {
  return clamp(value, MIN_OPACITY_PERCENT, MAX_OPACITY_PERCENT)
}
