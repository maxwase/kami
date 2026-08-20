import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "eu.maxwase.kami",
  appName: "Kami",
  webDir: "dist",
  // Intentionally no `server.url`: the app must load the locally bundled
  // `dist/` web build for App Store review, not a remote URL.
};

export default config;
