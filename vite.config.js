import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const host = process.env.TAURI_DEV_HOST;
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM || host);
// The Capacitor CLI sets no env of its own, so the iOS build opts in explicitly
// (see the `build:ios` script).
const isCapacitor = process.env.KAMI_TARGET === "capacitor";
// Anything that loads the bundle off disk rather than over HTTP.
const isNative = isTauri || isCapacitor;

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// PWA only for the web build; native shells load from disk, and a service
// worker inside a WebView just duplicates the bundle and serves stale assets
// after an app update.
const pwaPlugins = isNative
  ? []
  : [
      VitePWA({
        registerType: "autoUpdate",
        manifest: {
          name: "kami: Origami simulator",
          short_name: "kami",
          description:
            "Interactive origami folding demo that responds to device posture.",
          theme_color: "#201a14",
          background_color: "#201a14",
          display: "fullscreen",
          orientation: "any",
          // Lets the browser relate this PWA to the Play Store app so the
          // install prompt can be suppressed when the native app is installed
          // (checked at runtime via navigator.getInstalledRelatedApps()).
          related_applications: [
            {
              platform: "play",
              id: "eu.maxwase.kami.twa",
              url: "https://play.google.com/store/apps/details?id=eu.maxwase.kami.twa",
            },
          ],
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            {
              src: "pwa-maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,png,svg,jpg}"],
          // These are real static pages, not SPA routes — don't serve the
          // app shell for them via the navigate fallback.
          navigateFallbackDenylist: [
            /^\/privacy/,
            /^\/\.well-known/,
            /\.(txt|xml|json)$/,
          ],
        },
      }),
    ];

// https://vitejs.dev/config/
export default defineConfig({
  base: isNative ? "./" : "/",
  // Web is a multi-page static site (app at /, plus a standalone policy page).
  // MPA mode disables the SPA fallback so /privacy/ resolves to its own
  // index.html in dev and build — matches GitHub Pages serving.
  appType: isNative ? "spa" : "mpa",
  plugins: pwaPlugins,
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/ios/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*", "KAMI_"],
  build: isCapacitor
    ? {
        // WKWebView on the minimum supported iOS; the app ships no privacy
        // page of its own (that link goes to the hosted site instead), so the
        // default single index.html input is correct here.
        target: "safari15",
      }
    : isTauri
      ? {
          target:
            process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
          minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
          sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
        }
      : {
          rollupOptions: {
            input: {
              main: resolve(rootDir, "index.html"),
              privacy: resolve(rootDir, "privacy/index.html"),
            },
          },
        },
});
