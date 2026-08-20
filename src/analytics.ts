import posthog from "posthog-js";
import { resolveRuntimeInfo } from "./device/runtime";

const apiKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const apiHost = import.meta.env.VITE_POSTHOG_HOST as string | undefined;

const CONSENT_STORAGE_KEY = "kami_analytics_consent";

export enum FoldTrigger {
  Button = "button",
  KeyboardSpace = "keyboard_space",
  KeyboardEnter = "keyboard_enter",
  Hinge = "hinge",
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
  app_open: { launch_context: "twa" | "pwa" | "browser" };
  analytics_consent_changed: { granted: boolean };
}

let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;

  if (!apiKey || !apiHost) {
    if (import.meta.env.DEV) {
      const missingVariable = !apiKey ? "VITE_POSTHOG_KEY" : "VITE_POSTHOG_HOST";
      throw new Error(
        `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
      );
    }
    return;
  }

  posthog.init(apiKey, {
    api_host: apiHost,
    defaults: "2026-05-30",
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
  });
  initialized = true;

  if (getAnalyticsConsent() === "denied") {
    posthog.opt_out_capturing();
  }
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
  if (!initialized) return;
  if (granted) {
    posthog.opt_in_capturing({ captureEventName: false });
  } else {
    posthog.opt_out_capturing();
  }
}
