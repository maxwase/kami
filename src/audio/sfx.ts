/** Fold/flip sound effects, served from public/sounds/. */

import { options } from "../config/options";

function makePlayer(relativeSrc: string): () => void {
  // Native (Tauri/Capacitor) builds serve assets under a relative "./" base
  // instead of "/" (see vite.config.js) — resolve against BASE_URL so both
  // work.
  const src = `${import.meta.env.BASE_URL}${relativeSrc}`;
  const audio = new Audio(src);
  audio.preload = "auto";
  return () => {
    if (options.sfxVolume <= 0) return;
    // Clone so overlapping triggers (fast repeated folds) don't cut each
    // other off by restarting the same HTMLAudioElement.
    const instance = audio.cloneNode(true) as HTMLAudioElement;
    instance.volume = options.sfxVolume;
    void instance.play().catch((err: unknown) => {
      console.warn(`sfx: failed to play ${src}`, err);
    });
  };
}

export const playFoldSound = makePlayer("sounds/fold.mp3");
export const playFlapSound = makePlayer("sounds/flap.mp3");
