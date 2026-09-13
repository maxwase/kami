/**
 * iOS hinge bridge — stubbed.
 *
 * Apple ships no fold/hinge/posture API as of iOS SDK 26.5 (Xcode 27.0): there
 * is no such symbol anywhere in UIKit or CoreMotion. When one lands, this file
 * is the only place that changes — most likely by forwarding to a small
 * Capacitor plugin, the way `tauri.ts` forwards to a Rust command. Call sites
 * (`posture.ts`) stay as they are.
 *
 * Shape mirrors `getTauriPostureType()`: a synchronous read of a cached value,
 * safe to call every animation frame.
 */

/** Current posture string, or `"unknown"` when no hinge is readable. */
export function getCapacitorPostureType(): string {
  return "unknown";
}

/** Whether a real hinge sensor is readable on this device. */
export function isCapacitorHingeAvailable(): boolean {
  return false;
}
