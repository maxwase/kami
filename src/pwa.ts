// The plugin's injected script only checks for a new service worker on page
// load/navigation, throttled to 24h by spec — a user who reloads within that
// window or leaves a tab open for days never sees a fresh build. Polling
// registration.update() ourselves closes that gap; registerType: "autoUpdate"
// still owns activation (skipWaiting + reload once a new worker is found).
import { registerSW } from "virtual:pwa-register";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function registerServiceWorker(): void {
  const updateSW = registerSW({ immediate: true });

  setInterval(() => {
    if (document.visibilityState === "visible") void updateSW();
  }, UPDATE_CHECK_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void updateSW();
  });
}
