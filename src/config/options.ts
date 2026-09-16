import type { Vec2 } from "../math/vec2";

export interface GameOptions {
  /** Consider device stable if acceleration magnitude is below this (m/s²). */
  stableAccel: number;
  /** Flip detected fold direction (useful if the accelerometer is on the opposite side). */
  invertFoldDirection: boolean;
  /** Manual hinge position as a fraction of the viewport. */
  manualHingePos: Vec2;
  /** Whether to flip the hinge orientation by 90 degrees. */
  manualHingeDirFlip: boolean;
  /** Whether to show a border around the paper. */
  showPaperBorder: boolean;
  /** Fold/flip sound effect volume, 0 (muted) to 1 (full). */
  sfxVolume: number;
}

export const options: GameOptions = {
  stableAccel: 0.35,
  invertFoldDirection: false,
  manualHingePos: { x: 0.5, y: 0.5 },
  manualHingeDirFlip: false,
  showPaperBorder: true,
  sfxVolume: 0.5,
};

export function updateOptions(update: Partial<GameOptions>): void {
  if (typeof update.stableAccel === "number") {
    options.stableAccel = update.stableAccel;
  }
  if (typeof update.invertFoldDirection === "boolean") {
    options.invertFoldDirection = update.invertFoldDirection;
  }
  if (update.manualHingePos) {
    options.manualHingePos = { ...update.manualHingePos };
  }
  if (typeof update.manualHingeDirFlip === "boolean") {
    options.manualHingeDirFlip = update.manualHingeDirFlip;
  }
  if (typeof update.showPaperBorder === "boolean") {
    options.showPaperBorder = update.showPaperBorder;
  }
  if (typeof update.sfxVolume === "number") {
    options.sfxVolume = update.sfxVolume;
  }
}
