import {
  LOAD_TIMEOUT_MS,
  loadImage,
  withTimeout,
  type FrontImageSource,
} from "./textures";

/**
 * The tappable ad banner exists only for a plain web-browser visit (see
 * `isBrowserVisit` in main.ts) — never in the installed PWA, the Android
 * TWA, the iOS Capacitor app, or the Tauri macOS app. Which banner a browser
 * visitor sees depends on their device; every other platform gets an
 * ordinary paper sheet.
 */
export type BannerName = "playstore" | "appstore" | "mac";

interface BannerEntry {
  /** Path under /public, same convention as the other textures. */
  src: string;
  url: string;
}

export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=eu.maxwase.kami.twa";

// Placeholders — the user has not supplied the App Store / Mac App Store
// listing links yet. Replace these with the real URLs once the apps are
// published.
export const APP_STORE_URL = "https://apps.apple.com/app/id0000000000";
export const MAC_APP_STORE_URL = "https://apps.apple.com/app/id0000000001";

const REGISTRY: Record<BannerName, BannerEntry> = {
  playstore: { src: "textures/kami-banner.jpg", url: PLAY_STORE_URL },
  // Placeholder asset — the user has not supplied App Store banner artwork
  // yet. Drop the real image in at public/textures/kami-banner-appstore.jpg
  // and update APP_STORE_URL above; until then loadBanner() resolves null
  // here and the caller falls back to a plain paper sheet (see main.ts).
  appstore: { src: "textures/kami-banner-appstore.jpg", url: APP_STORE_URL },
  // Placeholder asset — same story, for public/textures/kami-banner-mac.jpg
  // and MAC_APP_STORE_URL.
  mac: { src: "textures/kami-banner-mac.jpg", url: MAC_APP_STORE_URL },
};

const cache = new Map<BannerName, Promise<FrontImageSource | null>>();

/**
 * Fetch a banner image by name, lazily and memoized per name. Any banner can
 * be requested regardless of platform — callers decide which name to ask
 * for. A missing file or slow/failed load resolves to null rather than
 * throwing, same contract as the old eager loader, so a caller can degrade
 * to a plain paper sheet instead of a broken render.
 */
export function loadBanner(name: BannerName): Promise<FrontImageSource | null> {
  let promise = cache.get(name);
  if (!promise) {
    promise = withTimeout(loadImage(REGISTRY[name].src), LOAD_TIMEOUT_MS).catch(
      () => null,
    );
    cache.set(name, promise);
  }
  return promise;
}

export function bannerUrl(name: BannerName): string {
  return REGISTRY[name].url;
}

/**
 * Which banner a plain web-browser visitor defaults to, from device signals
 * alone (platform/install-state gating happens in main.ts via
 * isBrowserVisit). iPadOS 13+ reports as a Mac in the UA string but keeps
 * touch support, hence the maxTouchPoints check.
 */
export function resolveDefaultBannerName(): BannerName {
  if (typeof navigator === "undefined") return "playstore";
  const ua = navigator.userAgent;
  const isIPad =
    /iPad/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIPhoneOrIPod = /iPhone|iPod/.test(ua);
  if (isIPad || isIPhoneOrIPod) return "appstore";
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  return "playstore";
}
