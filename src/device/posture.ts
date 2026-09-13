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
    return {
      controls: "<b>Fold</b>: close/open the device hinge.",
      gesture: "<b>One finger</b>: move.<br><b>Two fingers</b>: move + rotate.",
    };
  }
  // Phones without a readable hinge (every iPhone today) have no keyboard to
  // reference — point at the on-screen buttons instead.
  if (device === Device.Phone) {
    return {
      controls:
        "<b>Fold</b>, <b>Flip</b>, <b>Undo</b> and <b>Reset</b>: use the buttons.",
      gesture: "<b>One finger</b>: move.<br><b>Two fingers</b>: move + rotate.",
    };
  }
  return {
    controls: "<b>Space</b>: fold.<br><b>F</b>: flip.<br><b>R</b>: reset.",
    gesture: "<b>Drag</b>: move.<br><b>Alt/Opt + drag</b>: rotate.",
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
 * the hinge bridge actually working (it does not yet on iOS), which keeps the
 * manual-controls help copy and the Fold button as the primary interaction.
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
