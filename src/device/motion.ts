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

interface DeviceMotionEventCtor {
  requestPermission?: () => Promise<PermissionState | "granted" | "denied">;
}

let bound = false;

/**
 * Bind `devicemotion`, asking for permission first where iOS requires it.
 *
 * On iOS (Safari and WKWebView alike) `devicemotion` delivers nothing until
 * `DeviceMotionEvent.requestPermission()` resolves to `"granted"`, and that
 * call is only honoured inside a user gesture — so this must be invoked from
 * an event handler, not at startup. Elsewhere the method does not exist and
 * the listener binds directly.
 *
 * Safe to call more than once: only the first call does any work.
 *
 * @returns `true` once a listener is attached, `false` if permission was
 *   denied or the request threw (the app stays fully usable either way).
 */
export async function bindDeviceMotion(
  onEvent: (e: DeviceMotionEvent) => void,
): Promise<boolean> {
  if (bound) return true;

  const ctor = window.DeviceMotionEvent as unknown as DeviceMotionEventCtor | undefined;
  if (!ctor) return false;

  if (typeof ctor.requestPermission === "function") {
    try {
      if ((await ctor.requestPermission()) !== "granted") return false;
    } catch (err) {
      // Thrown when called outside a user gesture, or when the user has
      // permanently denied motion access for the app.
      console.warn("Device motion permission request failed", err);
      return false;
    }
    // The await above may have raced another caller.
    if (bound) return true;
  }

  bound = true;
  window.addEventListener("devicemotion", onEvent, { passive: true });
  return true;
}
