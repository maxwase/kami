import type { Paper } from "./model";
import { toggleSide } from "./model";

/** Animation duration for flip in seconds. */
const FLIP_DURATION_SECONDS = 0.5;

/** Animation data for an in-progress flip. */
export interface FlipAnim {
  /** Target paper identifier. */
  paperId: number;
  /** Normalized progress of the flip in [0,1]. */
  progress: number;
  /** Seconds the flip animation should take. */
  durationSeconds: number;
  /** Snapshot of faces before flip for animation. */
  originalFaces: Paper["faces"];
  /** Max layer before flip (for layer inversion). */
  maxLayer: number;
}

/** Build a flip animation for the given paper. */
export function buildFlipAnim(paper: Paper): FlipAnim {
  let maxLayer = 0;
  for (const f of paper.faces) {
    maxLayer = Math.max(maxLayer, f.layer);
  }

  // Clone faces for animation reference
  const originalFaces = paper.faces.map((f) => ({
    id: f.id,
    verts: f.verts.map((v) => ({ x: v.x, y: v.y })),
    up: f.up,
    layer: f.layer,
    outer: f.outer,
  }));

  return {
    paperId: paper.id,
    progress: 0,
    durationSeconds: FLIP_DURATION_SECONDS,
    originalFaces,
    maxLayer,
  };
}

/** Apply the final flipped state to the paper. */
export function commitFlip(paper: Paper, anim: FlipAnim): void {
  for (const f of paper.faces) {
    // Mirror horizontally: negate x, keep y (like flipping a page)
    f.verts = f.verts.map((v) => ({ x: -v.x, y: v.y }));
    // Toggle which side is facing up
    f.up = toggleSide(f.up);
    // Invert layer order: what was on bottom (layer 0) is now on top (highest layer)
    // what was on top (highest layer) is now on bottom (layer 0)
    f.layer = anim.maxLayer - f.layer;
    // After flip, all faces are outer surfaces (no sandwiched inner surfaces)
    f.outer = true;
  }
}
