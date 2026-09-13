import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "eu.maxwase.kami.ios",
  appName: "kami",
  webDir: "dist",
  // Matches the PWA manifest / theme-color so the gap behind the WebView
  // never flashes white during launch or rotation.
  backgroundColor: "#201a14",
  ios: {
    // The app is a full-screen canvas: let CSS env(safe-area-inset-*) own the
    // insets instead of having UIScrollView add its own.
    contentInset: "never",
    // Pointer gestures drive the fold; rubber-band scrolling fights them.
    scrollEnabled: false,
  },
};

export default config;
