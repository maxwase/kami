import { registerPlugin } from "@capacitor/core";
import { lerp } from "../math/scalars";
import type { Vec2 } from "../math/vec2";
import { Platform, resolveRuntimeInfo } from "./runtime";

interface MotionReading {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

interface MotionPluginInterface {
  startUpdates(options?: { intervalMs?: number }): Promise<void>;
  stopUpdates(): Promise<void>;
  getAcceleration(): Promise<MotionReading>;
  triggerHaptic(options?: { intensity?: number; sharpness?: number }): Promise<void>;
  addListener(
    eventName: "motion",
    listenerFunc: (reading: MotionReading) => void,
  ): Promise<{ remove: () => void }>;
}

/**
 * Native CoreMotion/CoreHaptics bridge, registered via the Swift plugin at
 * ios/App/App/MotionPlugin.swift. Only meaningfully available when running
 * under Capacitor's native iOS runtime; calling its methods elsewhere will
 * reject since no native implementation is registered.
 */
const NativeMotion = registerPlugin<MotionPluginInterface>("Motion");

/**
 * Fire a short haptic tap on fold completion via CoreHaptics. No-op on
 * non-Capacitor platforms (web, Tauri/macOS).
 */
export function triggerFoldHaptic(): void {
  if (resolveRuntimeInfo().platform !== Platform.Capacitor) return;
  NativeMotion.triggerHaptic().catch(() => {
    // Haptics are best-effort feedback; ignore failures (e.g. no engine).
  });
}

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

  const applyReading = (x: number | null | undefined, y: number | null | undefined) => {
    if (typeof x === "number") {
      accel = { x: lerp(accel.x, x, smoothing), y: accel.y };
    }
    if (typeof y === "number") {
      accel = { x: accel.x, y: lerp(accel.y, y, smoothing) };
    }
  };

  // On Capacitor's native iOS runtime, prefer CoreMotion accelerometer
  // updates over the web DeviceMotionEvent (which WKWebView also exposes,
  // but with coarser permission gating and less reliable delivery).
  if (resolveRuntimeInfo().platform === Platform.Capacitor) {
    NativeMotion.startUpdates().catch(() => {
      // No accelerometer / plugin unavailable; caller falls back to
      // whatever handleEvent() is fed (likely nothing, on native).
    });
    void NativeMotion.addListener("motion", (reading) => {
      applyReading(reading.x, reading.y);
    });
  }

  return {
    getAccel: () => ({
      x: accel.x * axisMultiplier.x * gain,
      y: accel.y * axisMultiplier.y * gain,
    }),
    handleEvent: (e) => {
      const acc = e.acceleration ?? e.accelerationIncludingGravity;
      if (!acc) return;
      applyReading(acc.x, acc.y);
    },
  };
}
