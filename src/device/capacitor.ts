/**
 * iOS hinge bridge.
 *
 * Apple shipped `UIHingeInteraction` / `UIHinge` in iOS 27.1 (Xcode 27.1) —
 * the first public fold API on the platform, and the thing this file was
 * always waiting for. It is wrapped by the standalone
 * `@maxwase/capacitor-hinge` plugin, which reports a Chrome-compatible
 * posture string, the raw hinge angle, and crease geometry. This module is
 * the only place in Kami that knows the plugin exists: call sites
 * (`posture.ts`, `hinge.ts`) see plain strings and `SegmentRect`s.
 *
 * Shape mirrors `getTauriPostureType()`: every getter is a synchronous read
 * of a cached value, safe to call every animation frame. The cache is filled
 * once at boot by `initCapacitorHinge()` and kept fresh by a `hingeChange`
 * subscription.
 *
 * The plugin is loaded with a dynamic import (same pattern as
 * `links.ts`) so that the web and Tauri bundles never pull in
 * `@capacitor/core`.
 */

import type { HingeCrease, HingeState } from "@maxwase/capacitor-hinge";
import type { Vec2 } from "../math/vec2";
import type { SegmentRect } from "./hinge";

let available = false;
let postureType = "unknown";
let angleDegrees: number | null = null;
let segments: SegmentRect[] = [];
let creaseDir: Vec2 | null = null;
let initialized = false;

/**
 * The iPhone Duo's inner display is seamless across the fold, so the plugin
 * reports a zero-width crease. `hingeFromSegments()` finds the crease as the
 * *gap* between two segments and ignores a zero gap, so give it a hairline to
 * measure. Sub-pixel, so it cannot shift the derived crease point.
 */
const MIN_CREASE_HALF_SPAN_PX = 0.5;

/**
 * Fold the plugin's tagged union down to the flat cached values this module
 * exposes. Narrowing on `kind` is what makes the fields legal to read: the
 * union only carries `crease`/`flat` on the `open` variant, so there is no
 * "meaningful but null" case left to guess about.
 *
 * `posture` and `crease` helpers exist in the plugin, but importing them
 * would be a *value* import of the package root, pulling `@capacitor/core`
 * into the web and Tauri bundles. The union is small enough to match by hand.
 */
function applyState(state: HingeState): void {
  available = state.kind !== "unavailable";

  switch (state.kind) {
    case "unavailable":
    case "indeterminate":
      postureType = "unknown";
      angleDegrees = null;
      creaseDir = null;
      segments = [];
      return;

    case "closed":
      postureType = "folded";
      angleDegrees = state.angle?.degrees ?? null;
      creaseDir = null;
      segments = [];
      return;

    case "open":
      postureType = state.flat ? "continuous" : "folded";
      angleDegrees = state.angle?.degrees ?? null;
      // The crease axis is the real fold line even before anything is bent,
      // so report the direction flat or not.
      creaseDir = state.crease ? creaseDirection(state.crease) : null;
      // Segments only while the device is actually bent: `resolveHingeState()`
      // reads two segments as book mode, and a flat Duo is not in book mode.
      segments = !state.flat && state.crease ? segmentsForCrease(state.crease) : [];
      return;
  }
}

function creaseDirection(crease: HingeCrease): Vec2 {
  return crease.axis === "vertical" ? { x: 0, y: 1 } : { x: 1, y: 0 };
}

function segmentsForCrease(crease: HingeCrease): SegmentRect[] {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const halfSpan = Math.max(crease.halfSpan, MIN_CREASE_HALF_SPAN_PX);
  const lo = crease.center - halfSpan;
  const hi = crease.center + halfSpan;

  if (crease.axis === "vertical") {
    return [rect(0, 0, lo, height), rect(hi, 0, width, height)];
  }
  return [rect(0, 0, width, lo), rect(0, hi, width, height)];
}

function rect(left: number, top: number, right: number, bottom: number): SegmentRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function clearState(): void {
  available = false;
  postureType = "unknown";
  angleDegrees = null;
  segments = [];
  creaseDir = null;
}

/**
 * Seed the cache and subscribe to hinge updates. Must be awaited before
 * `resolvePostureSupport()` runs, or support latches to `Unavailable` for the
 * lifetime of the page.
 */
export async function initCapacitorHinge(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const { Hinge } = await import("@maxwase/capacitor-hinge");
    await Hinge.addListener("hingeChange", applyState);
    applyState(await Hinge.getState());
  } catch (err) {
    console.warn("Capacitor hinge plugin unavailable", err);
    clearState();
  }
}

/** Current posture string, or `"unknown"` when no hinge is readable. */
export function getCapacitorPostureType(): string {
  return postureType;
}

/** Whether a real hinge sensor is readable on this device. */
export function isCapacitorHingeAvailable(): boolean {
  return available;
}

/** Two synthesized segments while the device is creased; empty otherwise. */
export function getCapacitorSegments(): SegmentRect[] {
  return segments;
}

/**
 * Direction the hardware fold line runs, or `null` when unknown. Reported
 * even while the device is flat, so the fold line can be drawn along the real
 * crease instead of being guessed from the viewport aspect ratio.
 */
export function getCapacitorCreaseDir(): Vec2 | null {
  return creaseDir;
}

/** Live hinge angle in degrees, or `null` when no hinge is readable. */
export function getCapacitorHingeAngle(): number | null {
  return angleDegrees;
}
