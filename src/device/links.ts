import { Platform, resolveRuntimeInfo } from "./runtime";

const runtime = resolveRuntimeInfo();

/**
 * Open an external URL.
 *
 * `target="_blank"` is a no-op inside a WKWebView, so on Capacitor the link
 * has to be handed to the native in-app browser or it simply does nothing.
 * Everywhere else the plain anchor behaviour is already correct, so the caller
 * is told to leave the event alone.
 *
 * @returns `true` when this function took over navigation and the caller
 *   should `preventDefault()`; `false` to let the anchor do its job.
 */
export function openExternal(url: string): boolean {
  if (runtime.platform !== Platform.Capacitor) return false;
  void import("@capacitor/browser")
    .then(({ Browser }) => Browser.open({ url }))
    .catch((err) => {
      console.warn("Failed to open external link", err);
    });
  return true;
}
