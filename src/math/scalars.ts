/** Small epsilon for floating comparisons. */
export const EPS = 1e-6;

/**
 * Clamp a scalar to inclusive bounds.
 * Mirrors Rust's saturating style: values outside [lo, hi] snap to the nearest edge.
 */
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Linear interpolation between a and b at fraction t (0..1). */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Smooth step with zero slope at ends; suitable for easing animation progress.
 * Matches the cubic easing commonly used in UI toolkits.
 */
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
