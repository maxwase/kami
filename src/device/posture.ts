import { getCapacitorPostureType, isCapacitorHingeAvailable } from "./capacitor";
import type { SegmentRect } from "./hinge";
import { Device, Platform, resolveRuntimeInfo } from "./runtime";
import { getTauriPostureType } from "./tauri";

const runtime = resolveRuntimeInfo();

export enum PostureSupport {
  Available = "available",
  Unavailable = "unavailable",
}

/** Physical device state derived from posture and viewport segments. */
export enum HingeState {
  /** Open and flat: no crease. Crease line follows the manual sliders. */
  Flat = "flat",
  /** Spanning the hinge (book mode): crease detected from the segment gap. */
  Creased = "creased",
  /** Folded shut: no usable segments. Operable only via the buttons. */
  Closed = "closed",
}

export interface HelpCopy {
  controls: string;
  gesture: string;
}

export function helpCopyForSupport(
  support: PostureSupport,
  device: Device = runtime.device,
): HelpCopy {
  if (support === PostureSupport.Available) {
    if (device === Device.Phone) {
      return {
        controls:
          "<b>Fold</b>: fold a half of the phone over the other, tap the paper.",
        gesture:
          "<b>Move</b>: one finger.<br><b>Rotate</b>: two fingers.<br><b>Flip</b>: quick two-finger swipe.",
      };
    }
    // Laptop with a readable hinge sensor (MacBook lid angle) — fold is
    // physical, but flip/reset/undo still go through the keyboard/buttons.
    return {
      controls:
        "<b>Fold</b>: close the lid, tap the paper.<br><b>Flip</b>: F key.<br><b>Reset</b>: R key.<br><b>Undo</b>: button.",
      gesture:
        "<b>Move</b>: drag.<br><b>Rotate</b>: Alt/Opt + drag, two-finger trackpad twist (Safari/Chrome).",
    };
  }
  // Phones without a readable hinge (every iPhone today) have no keyboard to
  // reference — point at the on-screen buttons instead.
  if (device === Device.Phone) {
    return {
      controls:
        "<b>Fold</b>: button, tap the paper.<br><b>Flip</b>: button.<br><b>Reset</b>: button.<br><b>Undo</b>: button.",
      gesture:
        "<b>Move</b>: one finger.<br><b>Rotate</b>: two fingers.<br><b>Flip</b>: quick two-finger swipe.",
    };
  }
  return {
    controls:
      "<b>Fold</b>: Space, tap the paper.<br><b>Flip</b>: F key.<br><b>Reset</b>: R key.<br><b>Undo</b>: button.",
    gesture:
      "<b>Move</b>: drag.<br><b>Rotate</b>: Alt/Opt + drag, two-finger trackpad twist (Safari/Chrome).",
  };
}

/** Resolve the current device posture string. */
export function readDevicePostureType(): string {
  const navAny = navigator as Navigator & {
    devicePosture?: { type?: string };
  };
  if (typeof navAny.devicePosture?.type === "string") return navAny.devicePosture.type;
  if (runtime.platform === Platform.Tauri) {
    return getTauriPostureType();
  }
  if (runtime.platform === Platform.Capacitor) {
    return getCapacitorPostureType();
  }
  return "unknown";
}

/**
 * Detect whether a posture source is present. On Capacitor this is gated on
 * the hinge bridge actually reporting a hinge — true on an iPhone Duo running
 * iOS 27.1 or later, false on every other iPhone, which keeps the
 * manual-controls help copy and the Fold button as the primary interaction
 * there.
 */
export function resolvePostureSupport(): PostureSupport {
  const navAny = navigator as Navigator & { devicePosture?: { type?: string } };
  if ("devicePosture" in navAny || runtime.platform === Platform.Tauri) {
    return PostureSupport.Available;
  }
  if (runtime.platform === Platform.Capacitor && isCapacitorHingeAvailable()) {
    return PostureSupport.Available;
  }
  return PostureSupport.Unavailable;
}

/**
 * Resolve the physical device state. Two or more viewport segments mean a
 * crease is visible (book mode); a folded-type posture without segments means
 * the device is shut; everything else is flat/open.
 */
export function resolveHingeState(
  postureType: string,
  segments: SegmentRect[],
): HingeState {
  if (segments.length >= 2) {
    return HingeState.Creased;
  }
  const t = postureType.toLowerCase();
  if (t === "folded" || t === "half-opened" || t === "flipped") {
    return HingeState.Closed;
  }
  return HingeState.Flat;
}
