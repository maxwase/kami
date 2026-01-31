import { lerp } from "../math/scalars";
import type { Vec2 } from "../math/vec2";

export interface MotionConfig {
  /** Per-axis multiplier to flip or scale the sensor direction. */
  axisMultiplier?: Vec2;
  /** Overall gain applied after axis multiplier. */
  gain?: number;
  /** Smoothing factor in [0,1], higher = less smoothing. */
  smoothing?: number;
}

/** Simple acceleration tracker in screen coordinates. */
export interface MotionTracker {
  /** Smoothed acceleration reading after gain and axis mapping. */
  getAccel: () => Vec2;
  /** Handler for devicemotion events. */
  handleEvent: (e: DeviceMotionEvent) => void;
}

/**
 * Track smoothed device acceleration in screen coordinates.
 * The caller should bind handleEvent to the devicemotion event.
 * Smoothing avoids jitter from noisy sensors.
 */
export function createMotionTracker(config: MotionConfig = {}): MotionTracker {
  let accel: Vec2 = { x: 0, y: 0 };
  const axisMultiplier: Vec2 = config.axisMultiplier ?? { x: 1, y: 1 };
  const gain = config.gain ?? 1;
  const smoothing = config.smoothing ?? 0.25;

  return {
    getAccel: () => ({
      x: accel.x * axisMultiplier.x * gain,
      y: accel.y * axisMultiplier.y * gain,
    }),
    handleEvent: (e) => {
      const acc = e.acceleration ?? e.accelerationIncludingGravity;
      if (!acc) return;
      if (typeof acc.x === "number") {
        accel = { x: lerp(accel.x, acc.x, smoothing), y: accel.y };
      }
      if (typeof acc.y === "number") {
        accel = { x: accel.x, y: lerp(accel.y, acc.y, smoothing) };
      }
    },
  };
}
