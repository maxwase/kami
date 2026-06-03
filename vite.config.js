import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const host = process.env.TAURI_DEV_HOST;
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM || host);

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// PWA only for the web build; Tauri loads from disk and needs no service worker.
const pwaPlugins = isTauri
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
          display: "standalone",
          orientation: "any",
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
          globPatterns: ["**/*.{js,css,html,png,svg}"],
          // These are real static pages, not SPA routes — don't serve the
          // app shell for them via the navigate fallback.
          navigateFallbackDenylist: [
            /^\/privacy/,
            /^\/cookie-policy/,
            /^\/\.well-known/,
          ],
        },
      }),
    ];

// https://vitejs.dev/config/
export default defineConfig({
  base: isTauri ? "./" : "/",
  // Web is a multi-page static site (app at /, plus standalone policy pages).
  // MPA mode disables the SPA fallback so /privacy/ and /cookie-policy/ resolve
  // to their own index.html in dev and build — matches GitHub Pages serving.
  appType: isTauri ? "spa" : "mpa",
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
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: isTauri
    ? {
        target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
        minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
        sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
      }
    : {
        rollupOptions: {
          input: {
            main: resolve(rootDir, "index.html"),
            privacy: resolve(rootDir, "privacy/index.html"),
            cookies: resolve(rootDir, "cookie-policy/index.html"),
          },
        },
      },
});
