import posthog from "posthog-js";
import { Platform, resolveRuntimeInfo } from "./device/runtime";

const apiKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const apiHost = import.meta.env.VITE_POSTHOG_HOST as string | undefined;

const CONSENT_STORAGE_KEY = "kami_analytics_consent";

export enum FoldTrigger {
  Button = "button",
  KeyboardSpace = "keyboard_space",
  KeyboardEnter = "keyboard_enter",
  Hinge = "hinge",
  Tap = "tap",
}

export enum FoldSource {
  Physical = "physical",
  Software = "software",
}

export enum PaperSide {
  Front = "front",
  Back = "back",
}

export enum Panel {
  Settings = "settings",
  Info = "info",
}

interface EventMap {
  paper_reset: {
    previous_face_count: number;
    aspect_ratio: string;
    fold_count: number;
  };
  undo_action: { remaining_undo_steps: number; fold_count: number };
  fold_triggered: {
    trigger_method: FoldTrigger;
    fold_source: FoldSource;
    fold_count: number;
  };
  panel_toggled: { panel: Panel; visible: boolean };
  keyboard_shortcut: { key: string; action: string };
  hinge_manual_adjusted: { axis: "x" | "y"; value: number };
  hinge_reset: Record<string, never>;
  stability_threshold_changed: { value: number };
  sfx_volume_changed: { value: number };
  invert_fold_direction_changed: { enabled: boolean };
  hinge_flip_changed: { enabled: boolean };
  show_paper_border_changed: { enabled: boolean };
  paper_size_changed: {
    size_type: string;
    aspect_ratio: string;
    custom_width?: number;
    custom_height?: number;
  };
  color_changed: { side: PaperSide; color: string };
  posture_change: {
    posture_type: string;
    hinge_x: number;
    hinge_y: number;
    screen_angle: number;
    stable: boolean;
    accel: { x: number; y: number };
  };
  fold_complete: {
    fold_count: number;
    fold_side: PaperSide;
    fold_source: FoldSource;
    hinge_x: number;
    hinge_y: number;
    duration_ms: number;
  };
  flip_complete: {
    face_count: number;
    fold_count: number;
    duration_ms: number;
  };
  gesture_used: { gesture_type: string; duration_ms: number };
  session_start: {
    device_type: string;
    posture_support: string;
    screen_width: number;
    screen_height: number;
    device_pixel_ratio: number;
  };
  outbound_link: { link_type: string; link_url: string };
  app_open: { launch_context: "ios" | "twa" | "pwa" | "browser" };
  analytics_consent_changed: { granted: boolean };
  playstore_banner_tapped: { banner: "playstore" | "appstore" | "mac" };
  paper_texture_changed: {
    side: "front" | "back";
    texture: "color" | "paper" | "banner" | "custom";
  };
  paper_color_mode_changed: {
    mode: "color" | "texture";
    texture: "paper" | "banner" | "custom" | null;
  };
  paper_custom_image_loaded: { side: "front" | "back"; width: number; height: number };
}

let initialized = false;

/**
 * Start analytics at boot, but only for a user who already opted in. PostHog
 * is not even initialized before consent: `init()` itself writes `ph_*`
 * storage and fetches remote config, which the privacy policy promises not to
 * do until the user taps "Allow".
 */
export function initAnalytics(): void {
  if (getAnalyticsConsent() === "granted") startPostHog();
}

function startPostHog(): void {
  if (initialized) return;

  if (!apiKey || !apiHost) {
    return;
  }

  posthog.init(apiKey, {
    api_host: apiHost,
    // Only ever reached after consent; opted out by default so a stale or
    // cleared SDK consent record can never make it capture on its own.
    opt_out_capturing_by_default: true,
    defaults: "2026-05-30",
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    // The whole app is a <canvas>, so rrweb's canvas capture (opt-in, since
    // it doesn't record pixels by default) balloons a session to tens of MB
    // here — even at 4fps/0.4 quality one session hit ~74MB and stalled
    // processing. Left off; session replay will show a blank canvas.
    // The iOS build never records sessions: the App Store privacy manifest
    // declares product interaction only, and replay would add more data types.
    disable_session_recording: resolveRuntimeInfo().platform === Platform.Capacitor,
  });
  initialized = true;
  posthog.opt_in_capturing({ captureEventName: false });
}

/**
 * Capture an analytics event. Adds a `platform` property (tauri/web/capacitor)
 * to every event so cross-platform breakdowns are possible in PostHog.
 * No-ops if analytics was never initialized (e.g. no API key configured).
 */
export function trackEvent<K extends keyof EventMap>(
  name: K,
  ...args: EventMap[K] extends Record<string, never> ? [] : [props: EventMap[K]]
): void {
  if (!initialized) return;
  const { platform } = resolveRuntimeInfo();
  posthog.capture(name, {
    ...(args[0] as Record<string, unknown> | undefined),
    platform,
  });
}

/** Reads the user's stored analytics consent choice. */
export function getAnalyticsConsent(): "granted" | "denied" | "unset" {
  const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
  if (stored === "granted" || stored === "denied") return stored;
  return "unset";
}

/** Persists the user's consent choice and toggles PostHog capturing accordingly. */
export function setAnalyticsConsent(granted: boolean): void {
  localStorage.setItem(CONSENT_STORAGE_KEY, granted ? "granted" : "denied");
  if (granted) {
    // First grant starts (and opts in) PostHog; a re-grant after withdrawal
    // finds it already running and only needs the opt-in.
    if (initialized) {
      posthog.set_config({ disable_persistence: false });
      posthog.opt_in_capturing({ captureEventName: false });
    } else {
      startPostHog();
    }
    return;
  }
  if (!initialized) return;
  // Withdrawal also wipes the SDK's stored ID and `ph_*` keys. reset() first:
  // it restores the default (opted-out) consent state, then make it explicit.
  posthog.reset();
  posthog.opt_out_capturing();
  // Opting out leaves what was already written (the random ID, cached flags)
  // and the SDK keeps saving to it, so switch persistence off before dropping
  // it. Next boot won't init without consent, so nothing brings it back.
  posthog.set_config({ disable_persistence: true });
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(`ph_${apiKey}`)) localStorage.removeItem(key);
  }
}
